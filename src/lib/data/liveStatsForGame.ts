/**
 * Live Match Centre stats for a game page — matched to approved lineup + user legs.
 */

import { and, eq, inArray, max } from "drizzle-orm";

import { db } from "@/db";
import { games, lineupPlayers, playerLiveStats } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import {
  getUserBetTracker,
} from "@/lib/data/bets";
import { playerRecordKey } from "@/lib/betTypes";
import type { ParsedLivePlayerRow } from "@/lib/ingest/aflMatchCentre";
import { resolveAflMatchIdForGame } from "@/lib/ingest/aflMatchForGame";
import { isLineupApproved } from "@/lib/ingest/lineupReview";
import { normalisePlayerName } from "@/lib/playerName";
import { resolveLiveGameState } from "@/lib/ingest/squiggle";

export type LiveStatCounts = {
  disposals: number;
  marks: number;
  goals: number;
  tackles: number;
  kicks: number;
  handballs: number;
};

export type LineupLivePlayer = {
  lineupId: number;
  playerName: string;
  team: string;
  jumper: number | null;
  status: string;
  counts: LiveStatCounts | null;
  matched: boolean;
};

export type LegLiveFeed = {
  value: number | null;
  /** Stat present in Match Centre feed for this leg. */
  fromFeed: boolean;
  onApprovedLineup: boolean;
};

export type GameLiveStatsPayload = {
  ok: true;
  lineupApproved: boolean;
  gameLive: boolean;
  gameComplete: boolean;
  aflMatchId: string | null;
  statsUpdatedAt: string | null;
  message: string | null;
  players: LineupLivePlayer[];
  /** `${normaliseName}:${statType}` → feed for your legs in this game. */
  legFeed: Record<string, LegLiveFeed>;
};

type LineupRow = {
  id: number;
  playerName: string;
  team: string;
  jumper: number | null;
  status: string;
};

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function statFromFeed(counts: LiveStatCounts, statType: string): number | null {
  switch (statType) {
    case "disposals":
      return counts.disposals;
    case "marks":
      return counts.marks;
    case "goals":
      return counts.goals;
    case "tackles":
      return counts.tackles;
    default:
      return null;
  }
}

/** Minimum MC rows to treat the official feed as complete for this fixture. */
export const MC_AUTHORITATIVE_MIN_PLAYERS = 22;

/**
 * Settlement actual: Match Centre (afl.com.au feed) when present.
 * When `mcAuthoritative`, never fall back to AFL Tables — leave null if MC
 * has no row for this player (leg stays pending rather than wrong).
 */
export function settlementStatValue(
  mc: number | null | undefined,
  fallback: number | null | undefined,
  opts?: { mcAuthoritative?: boolean },
): number | null {
  const m = mc ?? null;
  const f = fallback ?? null;
  if (m != null) return m;
  if (opts?.mcAuthoritative) return null;
  return f;
}

/** @deprecated Use settlementStatValue — kept as alias for tests. */
export function bestStatFromSources(
  statType: string,
  official: number | null | undefined,
  mc: number | null | undefined,
): number | null {
  void statType;
  return settlementStatValue(mc, official);
}

/** Resolve one stat from a player_game_stats or live-stats row. */
export function statValueFromRow(
  statType: string,
  row: {
    disposals?: number | null;
    marks?: number | null;
    goals?: number | null;
    tackles?: number | null;
  },
): number | null {
  switch (statType) {
    case "disposals":
      return row.disposals ?? null;
    case "marks":
      return row.marks ?? null;
    case "goals":
      return row.goals ?? null;
    case "tackles":
      return row.tackles ?? null;
    default:
      return null;
  }
}

/** Map AFL feed rows onto approved lineup players (name + team, surname tie-break). */
export function matchFeedToLineup(
  lineup: LineupRow[],
  feedRows: ParsedLivePlayerRow[],
): Map<number, LiveStatCounts> {
  const byLineupId = new Map<number, LiveStatCounts>();
  const claimed = new Set<number>();

  for (const row of feedRows) {
    const team = canonicalTeam(row.team) ?? row.team;
    const pool = lineup.filter((l) => (canonicalTeam(l.team) ?? l.team) === team);
    const liveNorm = normalisePlayerName(row.playerName);

    let hit: LineupRow | undefined = pool.find(
      (p) => normalisePlayerName(p.playerName) === liveNorm,
    );
    if (!hit) {
      const sur = surname(row.playerName);
      const surHits = pool.filter((p) => surname(p.playerName) === sur && !claimed.has(p.id));
      if (surHits.length === 1) hit = surHits[0];
    }
    if (!hit || claimed.has(hit.id)) continue;
    claimed.add(hit.id);
    byLineupId.set(hit.id, {
      disposals: row.disposals,
      marks: row.marks,
      goals: row.goals,
      tackles: row.tackles,
      kicks: row.kicks,
      handballs: row.handballs,
    });
  }
  return byLineupId;
}

export async function getGameLiveStatsPayload(
  gameId: number,
  userId: number,
  opts?: { legs?: Awaited<ReturnType<typeof getUserBetTracker>> },
): Promise<GameLiveStatsPayload> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) {
    return {
      ok: true,
      lineupApproved: false,
      gameLive: false,
      gameComplete: false,
      aflMatchId: null,
      statsUpdatedAt: null,
      message: "Game not found",
      players: [],
      legFeed: {},
    };
  }

  const lineupApproved = await isLineupApproved(gameId);

  let gameLive = game.status === "in_progress";
  if (
    !gameLive &&
    game.status !== "complete" &&
    game.season != null &&
    game.round != null
  ) {
    try {
      const sq = await resolveLiveGameState(
        game.season,
        game.round,
        game.squiggleId,
        game.home,
        game.away,
      );
      gameLive = sq?.status === "live";
    } catch {
      /* ignore */
    }
  }

  const kickedOff =
    game.commenceTime != null && game.commenceTime.getTime() <= Date.now();
  if (lineupApproved && (gameLive || kickedOff)) {
    const { refreshLiveStatsIfStale } = await import("@/lib/ingest/liveStatsSync");
    await refreshLiveStatsIfStale(gameId);
  }

  const squadLineup = await db
    .select({
      id: lineupPlayers.id,
      playerName: lineupPlayers.playerName,
      team: lineupPlayers.team,
      jumper: lineupPlayers.jumper,
      status: lineupPlayers.status,
    })
    .from(lineupPlayers)
    .where(
      and(
        eq(lineupPlayers.gameId, gameId),
        inArray(lineupPlayers.status, ["named", "interchange"]),
      ),
    );

  let message: string | null = null;
  if (!lineupApproved) {
    message = "Approve the squad on the lineup panel to match Match Centre stats to your sheet.";
  } else if (squadLineup.length === 0) {
    message = "Upload a lineup before live stats can be matched.";
  }

  const aflMatchId = await resolveAflMatchIdForGame(game);

  let feedRows: ParsedLivePlayerRow[] = [];
  let statsUpdatedAt: string | null = null;

  if (aflMatchId) {
    const rows = await db
      .select()
      .from(playerLiveStats)
      .where(eq(playerLiveStats.matchId, aflMatchId));
    if (rows.length > 0) {
      feedRows = rows.map((r) => ({
        playerId: r.playerId,
        playerName: r.playerName,
        team: r.team,
        goals: r.goals,
        kicks: r.kicks,
        handballs: r.handballs,
        disposals: r.disposals,
        marks: r.marks,
        tackles: r.tackles,
      }));
      const [agg] = await db
        .select({ latest: max(playerLiveStats.updatedAt) })
        .from(playerLiveStats)
        .where(eq(playerLiveStats.matchId, aflMatchId));
      if (agg?.latest) statsUpdatedAt = agg.latest.toISOString();
    } else if (gameLive) {
      message =
        message ??
        "Live feed not in database yet — tap Refresh MC or wait for cron (every 2 min).";
    }
  }

  const feedByLineupId =
    lineupApproved && squadLineup.length > 0
      ? matchFeedToLineup(squadLineup, feedRows)
      : new Map<number, LiveStatCounts>();

  const normToLineupId = new Map<string, number>();
  for (const p of squadLineup) {
    normToLineupId.set(normalisePlayerName(p.playerName), p.id);
  }

  const players: LineupLivePlayer[] = squadLineup.map((p) => {
    const counts = feedByLineupId.get(p.id) ?? null;
    return {
      lineupId: p.id,
      playerName: p.playerName,
      team: p.team,
      jumper: p.jumper,
      status: p.status,
      counts,
      matched: counts != null,
    };
  });

  const legFeed: Record<string, LegLiveFeed> = {};
  const myLegs =
    opts?.legs ?? (await getUserBetTracker(userId, gameId, game.round));

  for (const leg of myLegs) {
    const key = playerRecordKey(leg.playerName ?? "", leg.statType);
    const lineupId = leg.playerName
      ? normToLineupId.get(normalisePlayerName(leg.playerName))
      : undefined;
    const onApprovedLineup =
      lineupApproved && lineupId != null && feedByLineupId.has(lineupId);
    const counts = lineupId != null ? feedByLineupId.get(lineupId) : undefined;
    const value =
      onApprovedLineup && counts ? statFromFeed(counts, leg.statType) : null;
    legFeed[key] = {
      value,
      fromFeed: value != null,
      onApprovedLineup: lineupId != null && lineupApproved,
    };
  }

  return {
    ok: true,
    lineupApproved,
    gameLive,
    gameComplete: game.status === "complete",
    aflMatchId,
    statsUpdatedAt,
    message,
    players,
    legFeed,
  };
}

/** Build client feed map from API legFeed payload. */
export function legFeedValues(
  legFeed: Record<string, LegLiveFeed>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(legFeed)) {
    if (v.value != null) out[k] = v.value;
  }
  return out;
}
