import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  betLegs,
  bets,
  games,
  playerGameStats,
  systemTickets,
  type LegResult,
} from "@/db/schema";
import { currentSeason } from "@/lib/cron";
import { gamePlayerNameSet, legInGameScope, slipBetIdsForGame, type LegGameScope } from "@/lib/data/bets";
import { settleGamePlayerStats } from "@/lib/ingest/playerStats";
import { refreshGameFromSquiggle, syncFixtures } from "@/lib/ingest/sync";
import { computeRoundAccuracy } from "@/lib/predictions/accuracy";
import { gradeSystemBookForGame } from "@/lib/system/grade";

// ─────────────────────────────────────────────────────────────────────────────
// Settlement: once a game is complete and player stats are recorded, mark each
// bet leg hit/miss, then roll up each slip to won/lost.
//
// Legs linked to a game (or matched by round + player name on the live panel)
// settle from tap counts on "Game over", or from AFL Tables when published.
// ─────────────────────────────────────────────────────────────────────────────

export interface SettleResult {
  legsSettled: number;
  slipsSettled: number;
}

type BetLegRow = typeof betLegs.$inferSelect;

/** Pending legs for a game — same scope as the live "your bets" panel. */
async function pendingLegsForGame(gameId: number): Promise<BetLegRow[]> {
  const game = (
    await db
      .select({ round: games.round })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1)
  )[0];
  if (!game) return [];

  const gameNames = await gamePlayerNameSet(gameId);
  const rows = await db
    .select({ leg: betLegs, betRound: bets.round, betId: bets.id })
    .from(betLegs)
    .innerJoin(bets, eq(betLegs.betId, bets.id))
    .where(eq(betLegs.result, "pending"));

  const scopeLegs: LegGameScope[] = rows.map(({ leg, betRound, betId }) => ({
    betId,
    gameId: leg.gameId,
    playerName: leg.playerName,
    betRound,
  }));
  const slipBetIds = slipBetIdsForGame(scopeLegs, gameId, game.round, gameNames);

  return rows
    .filter(({ leg, betRound, betId }) =>
      legInGameScope(
        { betId, gameId: leg.gameId, playerName: leg.playerName, betRound },
        gameId,
        game.round,
        gameNames,
        slipBetIds,
      ),
    )
    .map(({ leg }) => leg);
}

/** Settle all pending legs whose game is complete and has player stats. */
export async function settlePendingBets(): Promise<SettleResult> {
  const pendingLegs = await db
    .select()
    .from(betLegs)
    .where(eq(betLegs.result, "pending"));

  let legsSettled = 0;
  const touchedBetIds = new Set<number>();

  for (const leg of pendingLegs) {
    if (!leg.gameId || !leg.playerId) continue;

    const game = (
      await db.select().from(games).where(eq(games.id, leg.gameId)).limit(1)
    )[0];
    if (!game || game.status !== "complete") continue;

    const stat = (
      await db
        .select()
        .from(playerGameStats)
        .where(
          and(
            eq(playerGameStats.gameId, leg.gameId),
            eq(playerGameStats.playerId, leg.playerId),
            eq(playerGameStats.settled, true),
          ),
        )
        .limit(1)
    )[0];
    if (!stat) continue; // no actuals yet — leave pending

    // Injured / DNP → void (stake returned on the slip).
    if (stat.didPlay === false) {
      const updated = await db
        .update(betLegs)
        .set({ result: "void", actualValue: null })
        .where(and(eq(betLegs.id, leg.id), eq(betLegs.result, "pending")))
        .returning({ id: betLegs.id });
      if (updated.length === 0) continue;
      legsSettled++;
      touchedBetIds.add(leg.betId);
      continue;
    }

    const actualValue = (stat as unknown as Record<string, number | null>)[
      leg.statType
    ];
    if (actualValue == null) continue;

    // Legs are stored as "over the line" bets.
    const result = actualValue > leg.line ? "hit" : "miss";
    const updated = await db
      .update(betLegs)
      .set({ result, actualValue })
      .where(and(eq(betLegs.id, leg.id), eq(betLegs.result, "pending")))
      .returning({ id: betLegs.id });
    if (updated.length === 0) continue;
    legsSettled++;
    touchedBetIds.add(leg.betId);
  }

  const slipsSettled = await rollUpSlips([...touchedBetIds]);
  return { legsSettled, slipsSettled };
}

import { deriveSlipStatus } from "@/lib/betTypes";
export async function rollUpSlips(betIds: number[]): Promise<number> {
  if (betIds.length === 0) return 0;

  const legs = await db
    .select()
    .from(betLegs)
    .where(inArray(betLegs.betId, betIds));

  const byBet = new Map<number, typeof legs>();
  for (const leg of legs) {
    const list = byBet.get(leg.betId) ?? [];
    list.push(leg);
    byBet.set(leg.betId, list);
  }

  let settled = 0;
  for (const [betId, legList] of byBet) {
    const status = deriveSlipStatus(legList);
    if (status === "pending") continue;
    await db
      .update(bets)
      .set({ status, settledAt: new Date() })
      .where(eq(bets.id, betId));
    settled++;
  }
  return settled;
}

/** Distinct game ids referenced by still-pending bet legs (for a scoped settle). */
export async function pendingLegGameIds(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ gameId: betLegs.gameId })
    .from(betLegs)
    .where(eq(betLegs.result, "pending"));
  return rows
    .map((r) => r.gameId)
    .filter((id): id is number => id != null);
}

/** Convenience: how many completed games still lack settled player stats. */
export async function gamesAwaitingStats(): Promise<number> {
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.status, "complete"));
  return rows.length;
}

/**
 * Manual fallback for a leg that auto-settlement will never reach (no
 * matched player, or AFL Tables never published the game) — set its result
 * by hand, then roll up its slip. `actualValue` is optional since a manual
 * void/override may not have a real number behind it.
 */
export async function settleLegManually(
  legId: number,
  betId: number,
  result: LegResult,
  actualValue?: number | null,
): Promise<void> {
  await db
    .update(betLegs)
    .set({ result, actualValue: actualValue ?? null })
    .where(eq(betLegs.id, legId));
  await rollUpSlips([betId]);
}

/** Live in-game count — keeps result pending until AFL Tables auto-settle. */
export async function updateLegLiveCount(
  legId: number,
  actualValue: number | null,
): Promise<void> {
  await db
    .update(betLegs)
    .set({ actualValue })
    .where(eq(betLegs.id, legId));
}

/**
 * Settle a slip directly from a bookmaker "Resulted" screenshot: write each
 * matched leg's result + actual value, stamp the result screenshot on the bet,
 * then roll the slip up to won/lost. Used by the post-game result upload, which
 * doesn't need a linked game/player or AFL Tables — the screenshot already has
 * the actuals. The morning pipeline later backfills any number we couldn't read.
 */
export async function applyResultMatches(
  betId: number,
  matches: { legId: number; result: LegResult; actualValue: number | null }[],
  resultScreenshotUrl?: string | null,
): Promise<SettleResult> {
  for (const m of matches) {
    await db
      .update(betLegs)
      .set({ result: m.result, actualValue: m.actualValue })
      .where(and(eq(betLegs.id, m.legId), eq(betLegs.betId, betId)));
  }
  if (resultScreenshotUrl) {
    await db
      .update(bets)
      .set({ resultScreenshotUrl })
      .where(eq(bets.id, betId));
  }
  const slipsSettled = await rollUpSlips([betId]);
  return { legsSettled: matches.length, slipsSettled };
}

/**
 * Reconcile actual values on already-settled legs against the official AFL
 * Tables figure once it publishes — the same source the fixtures' previous
 * results show. Refreshes the number whether it was missing or came from a
 * screenshot/manual entry, so the data we train the model on always matches
 * the real result. It never changes a leg's hit/miss (the bookie decides the
 * payout); only the recorded number is updated.
 */
export async function backfillSettledActuals(): Promise<number> {
  const legs = await db
    .select()
    .from(betLegs)
    .where(inArray(betLegs.result, ["hit", "miss"]));

  let filled = 0;
  for (const leg of legs) {
    if (!leg.gameId || !leg.playerId) continue;
    const stat = (
      await db
        .select()
        .from(playerGameStats)
        .where(
          and(
            eq(playerGameStats.gameId, leg.gameId),
            eq(playerGameStats.playerId, leg.playerId),
            eq(playerGameStats.settled, true),
          ),
        )
        .limit(1)
    )[0];
    if (!stat) continue;
    const actualValue = (stat as unknown as Record<string, number | null>)[
      leg.statType
    ];
    if (actualValue == null || actualValue === leg.actualValue) continue;
    await db
      .update(betLegs)
      .set({ actualValue })
      .where(eq(betLegs.id, leg.id));
    filled++;
  }
  return filled;
}

/** Settle all pending legs for one game that have AFL Tables actuals. */
export async function settlePendingBetsForGame(gameId: number): Promise<SettleResult> {
  const pendingLegs = await pendingLegsForGame(gameId);

  let legsSettled = 0;
  const touchedBetIds = new Set<number>();

  for (const leg of pendingLegs) {
    if (!leg.playerId) continue;

    const game = (
      await db.select().from(games).where(eq(games.id, gameId)).limit(1)
    )[0];
    if (!game || game.status !== "complete") continue;

    const stat = (
      await db
        .select()
        .from(playerGameStats)
        .where(
          and(
            eq(playerGameStats.gameId, gameId),
            eq(playerGameStats.playerId, leg.playerId),
            eq(playerGameStats.settled, true),
          ),
        )
        .limit(1)
    )[0];
    if (!stat) continue;

    const actualValue = (stat as unknown as Record<string, number | null>)[
      leg.statType
    ];
    if (actualValue == null) continue;

    const result = actualValue > leg.line ? "hit" : "miss";
    const updated = await db
      .update(betLegs)
      .set({
        result,
        actualValue,
        ...(leg.gameId == null ? { gameId } : {}),
      })
      .where(and(eq(betLegs.id, leg.id), eq(betLegs.result, "pending")))
      .returning({ id: betLegs.id });
    if (updated.length === 0) continue;
    legsSettled++;
    touchedBetIds.add(leg.betId);
  }

  const slipsSettled = await rollUpSlips([...touchedBetIds]);
  return { legsSettled, slipsSettled };
}

/** Finalise pending legs from in-game tap counts (actualValue already stored). */
export async function settleLegsFromLiveCounts(gameId: number): Promise<SettleResult> {
  const pendingLegs = await pendingLegsForGame(gameId);

  let legsSettled = 0;
  const touchedBetIds = new Set<number>();

  for (const leg of pendingLegs) {
    if (leg.actualValue == null) continue;
    const result = leg.actualValue > leg.line ? "hit" : "miss";
    const updated = await db
      .update(betLegs)
      .set({
        result,
        ...(leg.gameId == null ? { gameId } : {}),
      })
      .where(and(eq(betLegs.id, leg.id), eq(betLegs.result, "pending")))
      .returning({ id: betLegs.id });
    if (updated.length === 0) continue;
    legsSettled++;
    touchedBetIds.add(leg.betId);
  }

  const slipsSettled = await rollUpSlips([...touchedBetIds]);
  return { legsSettled, slipsSettled };
}

export interface GameOverSettlement {
  gameStatus: string | null;
  statsRecorded: number;
  fromStats: SettleResult;
  fromLive: SettleResult;
  systemBook: { ticketsGraded: number; legsUpdated: number };
}

/** Post-game: finalise tap counts first, then try AFL Tables for any left. */
export async function runGameOverSettlement(gameId: number): Promise<GameOverSettlement> {
  const game = (
    await db.select().from(games).where(eq(games.id, gameId)).limit(1)
  )[0];
  if (!game) throw new Error("game not found");

  // Live counts first — fast and matches how you watch the game.
  const fromLive = await settleLegsFromLiveCounts(gameId);

  // Just this fixture from Squiggle (not the whole season — avoids timeouts).
  await refreshGameFromSquiggle(gameId).catch((err) => {
    console.warn(`[game-over] Squiggle refresh for game ${gameId}:`, err);
  });

  const statsResult = await settleGamePlayerStats(gameId);
  const fromStats = await settlePendingBetsForGame(gameId);
  const systemBook = await gradeSystemBookForGame(gameId).catch((err) => {
    console.warn(`[game-over] system book grade for game ${gameId}:`, err);
    return { ticketsGraded: 0, legsUpdated: 0 };
  });

  const updated = (
    await db.select({ status: games.status }).from(games).where(eq(games.id, gameId)).limit(1)
  )[0];

  return {
    gameStatus: updated?.status ?? null,
    statsRecorded: statsResult.recorded,
    fromStats,
    fromLive,
    systemBook,
  };
}

export interface SettlementPipelineResult {
  sync: Awaited<ReturnType<typeof syncFixtures>>;
  statsRecorded: number;
  settle: SettleResult;
  actualsBackfilled: number;
  accuracyRows: number;
  systemTicketsGraded: number;
  /** Strategy lab catch-up after new actuals (null if skipped / failed). */
  lab: {
    runId: number;
    gamesProcessed: number;
    slipsWritten: number;
  } | null;
  /** Bankroll sim re-run against the lab source (null if skipped / failed). */
  bankrollRunId: number | null;
}

/**
 * Games the daily cron should touch: latest completed round (+ previous if
 * stats still thin), plus any with ungraded System tickets or pending personal
 * legs. Never re-scrapes the whole season — historical rounds stay in
 * player_game_stats.
 */
export async function gamesNeedingSettlement(
  season: number,
): Promise<number[]> {
  const ids = new Set<number>();

  const [latest] = await db
    .select({ round: games.round })
    .from(games)
    .where(and(eq(games.season, season), eq(games.status, "complete")))
    .orderBy(desc(games.round))
    .limit(1);

  if (latest?.round != null) {
    const rounds = [latest.round];
    // One round back — AFL Tables often lags a day on Sunday night games.
    if (latest.round > 0) rounds.push(latest.round - 1);

    const recent = await db
      .select({ id: games.id })
      .from(games)
      .where(
        and(
          eq(games.season, season),
          eq(games.status, "complete"),
          inArray(games.round, rounds),
        ),
      );
    for (const g of recent) ids.add(g.id);
  }

  const [ungradedSystem, pendingPersonal] = await Promise.all([
    db
      .selectDistinct({ gameId: systemTickets.gameId })
      .from(systemTickets)
      .innerJoin(games, eq(games.id, systemTickets.gameId))
      .where(
        and(
          eq(games.season, season),
          isNull(systemTickets.slipHit),
          sql`${systemTickets.stake} is not null and ${systemTickets.stake} > 0`,
        ),
      ),
    pendingLegGameIds(),
  ]);
  for (const r of ungradedSystem) ids.add(r.gameId);
  for (const id of pendingPersonal) ids.add(id);

  return [...ids];
}

/**
 * Morning-after pipeline: sync Squiggle → append AFL Tables actuals for
 * games that still need them → grade System book + personal bets → accuracy
 * → catch up Strategy lab + bankroll sim when new actuals landed.
 * Shared by daily cron and "Settle now". Pass `gameIds` to force a scope;
 * default is latest round(s) only (not the whole season).
 *
 * Surfaces after a successful run:
 *   System  — graded tickets (immediate)
 *   Review  — settled legs + model_accuracy (immediate)
 *   Leaders — season avgs from player_game_stats (immediate read)
 *   Lab     — strategy-lab + bankroll when statsRecorded > 0
 */
export async function runSettlementPipeline(
  opts: { gameIds?: number[]; refreshLab?: boolean } = {},
): Promise<SettlementPipelineResult> {
  const season = currentSeason();
  const sync = await syncFixtures(season);

  const targetIds =
    opts.gameIds ?? (await gamesNeedingSettlement(season));

  const completed =
    targetIds.length === 0
      ? []
      : await db
          .select({ id: games.id, round: games.round })
          .from(games)
          .where(
            and(eq(games.status, "complete"), inArray(games.id, targetIds)),
          );

  let statsRecorded = 0;
  let systemTicketsGraded = 0;
  const rounds = new Set<number>();
  for (const g of completed) {
    const res = await settleGamePlayerStats(g.id);
    statsRecorded += res.recorded;
    if (g.round != null && (res.recorded > 0 || res.skipped > 0)) {
      rounds.add(g.round);
    }
    const graded = await gradeSystemBookForGame(g.id).catch(() => ({
      ticketsGraded: 0,
      legsUpdated: 0,
    }));
    systemTicketsGraded += graded.ticketsGraded;
  }

  const settle = await settlePendingBets();
  const actualsBackfilled = await backfillSettledActuals();

  let accuracyRows = 0;
  for (const round of rounds) {
    const acc = await computeRoundAccuracy(season, round);
    accuracyRows += acc.rowsWritten;
  }

  // Lab + bankroll: when new actuals landed, or caller forced refreshLab: true.
  // Leaders/System/Review already read settled tables — no extra step.
  let lab: SettlementPipelineResult["lab"] = null;
  let bankrollRunId: number | null = null;
  const wantLab =
    opts.refreshLab === true ||
    (opts.refreshLab !== false && statsRecorded > 0);
  if (wantLab) {
    try {
      const { runWeeklyStrategyLab } = await import("@/lib/backtest/runner");
      const labResult = await runWeeklyStrategyLab({
        season,
        onProgress: (msg) => console.log(`[settle→lab] ${msg}`),
      });
      lab = {
        runId: labResult.runId,
        gamesProcessed: labResult.gamesProcessed,
        slipsWritten: labResult.slipsWritten,
      };
      // Re-sim bankroll when lab graded new games, or when lab was force-refreshed.
      if (labResult.gamesProcessed > 0 || opts.refreshLab === true) {
        const { runBankrollSim } = await import("@/lib/system/bankroll");
        const br = await runBankrollSim({
          sourceRunId: labResult.runId,
          persist: true,
          label: `bankroll-after-settle-${season}`,
        });
        bankrollRunId = br.runId;
      }
    } catch (err) {
      console.error("[settle] lab/bankroll refresh failed:", err);
    }
  }

  return {
    sync,
    statsRecorded,
    settle,
    actualsBackfilled,
    accuracyRows,
    systemTicketsGraded,
    lab,
    bankrollRunId,
  };
}
