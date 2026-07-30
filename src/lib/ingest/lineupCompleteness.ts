import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { lineupPlayers, predictions } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { selectedCount } from "@/lib/ingest/lineupAudit";
import type { StatType } from "@/db/schema";
import { STAT_TYPES } from "@/lib/predictions/features";
import {
  loadBookmakerLinePrices,
  loadOddsSnapshotPrices,
  mergePriceMaps,
  playerHasAnyOdds,
} from "@/lib/system/oddsPrices";
import { isLineupApproved } from "@/lib/ingest/lineupReview";
import {
  backfillLineupPlayerIds,
  resolveLineupPlayerIds,
} from "@/lib/ingest/lineupPlayerResolve";

export type LineupPlayerGap =
  | "missing_player_link"
  | "missing_position"
  | "missing_predictions"
  | "missing_odds";

export type LineupPlayerAuditRow = {
  lineupId: number;
  playerName: string;
  team: string;
  jumper: number | null;
  position: string | null;
  status: "named" | "interchange" | "emergency";
  playerId: number | null;
  gaps: LineupPlayerGap[];
  /** When missing_odds — which markets (tackles-only is common for forwards). */
  missingOddsMarkets?: StatType[];
};

export type LineupCompletenessReport = {
  gameId: number;
  home: string;
  away: string;
  selectedPerTeam: { home: number; away: number };
  expectedSelected: number;
  players: LineupPlayerAuditRow[];
  summary: {
    selected: number;
    fullyReady: number;
    missingLink: number;
    missingPosition: number;
    missingPredictions: number;
    missingOdds: number;
  };
};

const EXPECTED_SELECTED = 22;

/** Books often skip tackle (or other) lines for some players — core SGM markets first. */
const ODDS_REQUIRED: StatType[] = ["disposals", "marks", "goals"];

function missingOddsForPlayer(
  prices: Map<string, number>,
  playerId: number,
): StatType[] {
  const missing: StatType[] = [];
  for (const st of ODDS_REQUIRED) {
    if (!playerHasAnyOdds(prices, playerId, st)) missing.push(st);
  }
  for (const st of STAT_TYPES) {
    if (ODDS_REQUIRED.includes(st)) continue;
    if (!playerHasAnyOdds(prices, playerId, st)) missing.push(st);
  }
  return missing;
}

function oddsGap(missing: StatType[]): boolean {
  return ODDS_REQUIRED.some((st) => missing.includes(st));
}

export async function buildLineupCompletenessReport(
  gameId: number,
  home: string,
  away: string,
): Promise<LineupCompletenessReport> {
  const homeC = canonicalTeam(home) ?? home;
  const awayC = canonicalTeam(away) ?? away;

  await backfillLineupPlayerIds(gameId, homeC, awayC);

  const lineup = await db
    .select()
    .from(lineupPlayers)
    .where(eq(lineupPlayers.gameId, gameId));

  const selected = lineup.filter((r) => r.status !== "emergency");

  const preds = await db
    .select({
      playerId: predictions.playerId,
      statType: predictions.statType,
    })
    .from(predictions)
    .where(and(eq(predictions.gameId, gameId), eq(predictions.model, "C")));

  const predStatsByPlayer = new Map<number, Set<string>>();
  for (const p of preds) {
    const set = predStatsByPlayer.get(p.playerId) ?? new Set();
    set.add(p.statType);
    predStatsByPlayer.set(p.playerId, set);
  }

  const [snapPrices, bookPrices] = await Promise.all([
    loadOddsSnapshotPrices(gameId).catch(() => new Map()),
    loadBookmakerLinePrices(gameId).catch(() => new Map()),
  ]);
  const prices = mergePriceMaps(bookPrices, snapPrices);

  const idByLineup = await resolveLineupPlayerIds(gameId, homeC, awayC);

  const auditRows: LineupPlayerAuditRow[] = selected.map((lp) => {
    const playerId = idByLineup.get(lp.id) ?? lp.playerId ?? null;
    const gaps: LineupPlayerGap[] = [];
    if (playerId == null) {
      gaps.push("missing_player_link");
      return {
        lineupId: lp.id,
        playerName: lp.playerName,
        team: canonicalTeam(lp.team) ?? lp.team,
        jumper: lp.jumper,
        position: lp.position,
        status: lp.status,
        playerId,
        gaps,
      };
    }
    if (lp.status === "named" && !lp.position?.trim()) gaps.push("missing_position");
    const stats = predStatsByPlayer.get(playerId);
    const missingPred = STAT_TYPES.some((st) => !stats?.has(st));
    if (missingPred) gaps.push("missing_predictions");
      const missingMarkets = missingOddsForPlayer(prices, playerId);
      if (oddsGap(missingMarkets) && lp.status !== "interchange") {
        gaps.push("missing_odds");
      }
    return {
      lineupId: lp.id,
      playerName: lp.playerName,
      team: canonicalTeam(lp.team) ?? lp.team,
      jumper: lp.jumper,
      position: lp.position,
      status: lp.status,
      playerId,
      gaps,
      missingOddsMarkets:
        missingMarkets.length > 0 ? missingMarkets : undefined,
    };
  });

  const auditRowsFiltered = auditRows;
  const fullyReady = auditRowsFiltered.filter((r) => r.gaps.length === 0).length;

  return {
    gameId,
    home: homeC,
    away: awayC,
    selectedPerTeam: {
      home: selectedCount(
        selected.map((r) => ({
          team: canonicalTeam(r.team) ?? r.team,
          playerName: r.playerName,
          jumper: r.jumper,
          status: r.status,
        })),
        homeC,
      ),
      away: selectedCount(
        selected.map((r) => ({
          team: canonicalTeam(r.team) ?? r.team,
          playerName: r.playerName,
          jumper: r.jumper,
          status: r.status,
        })),
        awayC,
      ),
    },
    expectedSelected: EXPECTED_SELECTED,
    players: auditRowsFiltered,
    summary: {
      selected: selected.length,
      fullyReady,
      missingLink: auditRowsFiltered.filter((r) => r.gaps.includes("missing_player_link"))
        .length,
      missingPosition: auditRowsFiltered.filter((r) =>
        r.gaps.includes("missing_position"),
      ).length,
      missingPredictions: auditRowsFiltered.filter((r) =>
        r.gaps.includes("missing_predictions"),
      ).length,
      missingOdds: auditRowsFiltered.filter((r) => r.gaps.includes("missing_odds")).length,
    },
  };
}

export type LineupSystemGate = {
  ok: boolean;
  blockReason: string | null;
  oddsWarning: string | null;
};

/** Hard stop before System / chooser when squad data is untrusted. */
export function lineupGateForSystem(
  report: LineupCompletenessReport,
): LineupSystemGate {
  const { home, away, selectedPerTeam, summary } = report;
  if (summary.selected === 0) {
    return {
      ok: false,
      blockReason:
        "No lineup uploaded — paste or upload team sheets before generating the System book.",
      oddsWarning: null,
    };
  }
  if (selectedPerTeam.home < 20 || selectedPerTeam.away < 20) {
    return {
      ok: false,
      blockReason: `Lineup incomplete (${selectedPerTeam.home} ${home} / ${selectedPerTeam.away} ${away} selected; need ~22 each = 18 field + 4 INT). Re-paste or upload before System book.`,
      oddsWarning: null,
    };
  }
  if (summary.missingLink > 0) {
    const namedMissingLink = report.players.filter(
      (p) => p.status === "named" && p.gaps.includes("missing_player_link"),
    ).length;
    if (namedMissingLink > 0) {
      return {
        ok: false,
        blockReason: `${namedMissingLink} field player(s) not linked to AFL Tables — fix names/jumpers and run Generate predictions.`,
        oddsWarning: null,
      };
    }
  }
  if (summary.missingPosition > 0) {
    return {
      ok: false,
      blockReason: `${summary.missingPosition} named player(s) missing field position — re-upload lineup with FB/HB/C rows.`,
      oddsWarning: null,
    };
  }

  let oddsWarning: string | null = null;
  const missingPred = report.players.filter((p) =>
    p.gaps.includes("missing_predictions"),
  );
  if (missingPred.length > 0) {
    const debutNames = missingPred.map((p) => p.playerName).slice(0, 4);
    const suffix =
      missingPred.length > debutNames.length
        ? ` (+${missingPred.length - debutNames.length} more)`
        : "";
    oddsWarning = `${missingPred.length} player(s) without Model C predictions (${debutNames.join(", ")}${suffix} — usually debuts with no AFL Tables history). System book skips them; run Generate predictions again once they have a career game.`;
  }
  const intMissingLink = report.players.filter(
    (p) => p.status === "interchange" && p.gaps.includes("missing_player_link"),
  ).length;
  if (intMissingLink > 0) {
    const msg = `${intMissingLink} interchange player(s) not on AFL Tables yet (stub roster only — unlikely in System legs).`;
    oddsWarning = oddsWarning ? `${oddsWarning} ${msg}` : msg;
  }
  if (summary.missingOdds > 0) {
    const oddsMsg = `${summary.missingOdds} selected player(s) missing odds on one or more markets — harvest odds or check name/jumper matching. System book will still build using model lines where prices are absent.`;
    oddsWarning = oddsWarning ? `${oddsWarning} ${oddsMsg}` : oddsMsg;
  }

  return { ok: true, blockReason: null, oddsWarning };
}

export async function assertLineupReadyForSystem(
  gameId: number,
  home: string,
  away: string,
): Promise<LineupSystemGate> {
  const report = await buildLineupCompletenessReport(gameId, home, away);
  const gate = lineupGateForSystem(report);
  if (!gate.ok) return gate;

  const approved = await isLineupApproved(gameId);
  if (!approved) {
    return {
      ok: false,
      blockReason:
        "Lineup not approved — open the squad grid, check names/positions/bands, then tap Approve lineup.",
      oddsWarning: gate.oddsWarning,
    };
  }
  return gate;
}
