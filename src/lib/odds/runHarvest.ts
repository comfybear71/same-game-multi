import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { games, oddsSnapshots, players } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import {
  fetchEventPlayerProps,
  listAflEvents,
  listSports,
  logSkippedMarkets,
} from "@/lib/odds/client";
import { dedupeSnapshots } from "@/lib/odds/dedupe";
import { HARVEST_MARKETS } from "@/lib/odds/markets";
import { matchGameToEvent } from "@/lib/odds/matchGame";
import { parseBookmakerProps } from "@/lib/odds/parseOutcomes";
import { QuotaFloorError, type QuotaStatus } from "@/lib/odds/quota";
import {
  resolvePlayerId,
  type PlayerCandidate,
} from "@/lib/odds/resolvePlayer";

export type HarvestOptions = {
  apiKey: string;
  floor?: number;
  delayMs?: number;
  /** When false, suppress console chatter (cron). Default true. */
  log?: boolean;
};

export type HarvestReport = {
  snapshotAt: string;
  eventsTotal: number;
  eventsCovered: number;
  rowsWritten: number;
  unmatchedEvents: string[];
  unresolvedPlayers: { name: string; count: number }[];
  skippedMarkets: string[];
  quota: QuotaStatus;
  abortedOnQuota: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runOddsHarvest(
  opts: HarvestOptions,
): Promise<HarvestReport> {
  const apiKey = opts.apiKey.trim();
  const floor = opts.floor ?? Number(process.env.ODDS_QUOTA_FLOOR ?? "50");
  const delayMs = opts.delayMs ?? 350;
  const log = opts.log !== false;
  const snapshotAt = new Date();
  const say = (...args: unknown[]) => {
    if (log) console.log(...args);
  };

  say("\n=== Odds API harvest (AFL player props) ===");
  say(`snapshotAt=${snapshotAt.toISOString()}`);
  say(`markets=${HARVEST_MARKETS.join(",")}`);
  say(`quota floor=${floor} · delay=${delayMs}ms`);

  const skippedMarkets = logSkippedMarkets();
  say(
    `Skipping (documented, not harvested): ${skippedMarkets.join(", ") || "(none)"}`,
  );

  let quota: QuotaStatus = { remaining: null, used: null };
  let abortedOnQuota = false;

  const sports = await listSports(apiKey, floor);
  quota = sports.quota;
  say(
    `Sports OK · credits remaining=${quota.remaining ?? "?"} used=${quota.used ?? "?"}`,
  );
  if (!sports.keys.includes("aussierules_afl")) {
    throw new Error("aussierules_afl not in /sports — check subscription");
  }

  const { events, quota: q1 } = await listAflEvents(apiKey, floor);
  quota = q1;
  say(`Events: ${events.length} · remaining=${quota.remaining ?? "?"}`);

  if (events.length === 0) {
    return {
      snapshotAt: snapshotAt.toISOString(),
      eventsTotal: 0,
      eventsCovered: 0,
      rowsWritten: 0,
      unmatchedEvents: [],
      unresolvedPlayers: [],
      skippedMarkets,
      quota,
      abortedOnQuota: false,
    };
  }

  const now = Date.now();
  const gameRows = await db
    .select({
      id: games.id,
      home: games.home,
      away: games.away,
      commenceTime: games.commenceTime,
      oddsApiId: games.oddsApiId,
    })
    .from(games)
    .where(gte(games.commenceTime, new Date(now - 48 * 60 * 60 * 1000)));

  const playerCandidates: PlayerCandidate[] = await db
    .select({
      id: players.id,
      name: players.name,
      team: players.team,
    })
    .from(players);

  const marketSet = new Set<string>(HARVEST_MARKETS);
  let eventsCovered = 0;
  let rowsWritten = 0;
  const unresolved = new Map<string, number>();
  const unmatchedEvents: string[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    say(
      `\n[${i + 1}/${events.length}] ${ev.home_team} v ${ev.away_team} (${ev.id.slice(0, 8)}…)`,
    );

    let data;
    try {
      const res = await fetchEventPlayerProps(apiKey, ev.id, floor);
      data = res.data;
      quota = res.quota;
    } catch (err) {
      if (err instanceof QuotaFloorError) {
        say(`\n${err.message}`);
        abortedOnQuota = true;
        break;
      }
      throw err;
    }

    say(
      `  credits remaining=${quota.remaining ?? "?"} used=${quota.used ?? "?"}`,
    );

    const game = matchGameToEvent(gameRows, {
      id: ev.id,
      homeTeam: ev.home_team,
      awayTeam: ev.away_team,
      commenceTime: ev.commence_time,
    });
    if (!game) {
      unmatchedEvents.push(`${ev.home_team} v ${ev.away_team}`);
      say("  (no matching games row — storing with gameId=null)");
    } else if (!game.oddsApiId) {
      await db
        .update(games)
        .set({ oddsApiId: ev.id, updatedAt: new Date() })
        .where(and(eq(games.id, game.id)));
      game.oddsApiId = ev.id;
    }

    const homeC = canonicalTeam(ev.home_team);
    const awayC = canonicalTeam(ev.away_team);
    const parsed = parseBookmakerProps(
      data.bookmakers as Parameters<typeof parseBookmakerProps>[0],
      marketSet,
    );

    const rows = dedupeSnapshots(
      parsed.map((p) => {
        let playerId =
          resolvePlayerId(p.playerName, playerCandidates, homeC) ??
          resolvePlayerId(p.playerName, playerCandidates, awayC);
        if (playerId == null) {
          // No team-less surname-only merge (resolvePlayer requires teamHint
          // for surname-only). Full-name / nickname still works without hint.
          playerId = resolvePlayerId(p.playerName, playerCandidates, null);
        }
        if (playerId == null) {
          unresolved.set(
            p.playerName,
            (unresolved.get(p.playerName) ?? 0) + 1,
          );
        }
        return {
          oddsApiEventId: ev.id,
          gameId: game?.id ?? null,
          playerName: p.playerName,
          playerId,
          marketKey: p.marketKey,
          statFamily: p.statFamily,
          line: p.line,
          overOdds: p.overOdds,
          underOdds: p.underOdds,
          bookmaker: p.bookmaker,
          snapshotAt,
        };
      }),
    );

    if (rows.length > 0) {
      const chunk = 200;
      for (let c = 0; c < rows.length; c += chunk) {
        await db.insert(oddsSnapshots).values(rows.slice(c, c + chunk));
      }
      rowsWritten += rows.length;
    }
    eventsCovered++;
    say(`  rows=${rows.length}`);
  }

  const unresolvedPlayers = [...unresolved.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  say("\n=== Harvest summary ===");
  say(`Events covered: ${eventsCovered}/${events.length}`);
  say(`Rows written:   ${rowsWritten}`);
  say(
    `Credits:        remaining=${quota.remaining ?? "?"} used=${quota.used ?? "?"}`,
  );
  if (unmatchedEvents.length > 0) {
    say(`Unmatched fixtures (${unmatchedEvents.length}):`);
    for (const u of unmatchedEvents) say(`  - ${u}`);
  }
  if (unresolvedPlayers.length > 0) {
    say(`Unresolved player names (${unresolvedPlayers.length}):`);
    for (const { name, count } of unresolvedPlayers.slice(0, 40)) {
      say(`  - ${name} (×${count})`);
    }
    if (unresolvedPlayers.length > 40) {
      say(`  … +${unresolvedPlayers.length - 40} more`);
    }
  } else {
    say("Unresolved player names: (none)");
  }
  say("");

  return {
    snapshotAt: snapshotAt.toISOString(),
    eventsTotal: events.length,
    eventsCovered,
    rowsWritten,
    unmatchedEvents,
    unresolvedPlayers,
    skippedMarkets,
    quota,
    abortedOnQuota,
  };
}
