import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { betLegs, bets, games, playerGameStats, type LegResult } from "@/db/schema";
import { currentSeason } from "@/lib/cron";
import { settleGamePlayerStats } from "@/lib/ingest/playerStats";
import { syncFixtures } from "@/lib/ingest/sync";
import { computeRoundAccuracy } from "@/lib/predictions/accuracy";

// ─────────────────────────────────────────────────────────────────────────────
// Settlement: once a game is complete and player stats are recorded, mark each
// bet leg hit/miss, then roll up each slip to won/lost.
//
// A leg only auto-settles once it has both a linked game and a matched
// player (set when the bet was saved). Legs missing either stay "pending"
// forever — see settleLegManually() for the fallback override.
// ─────────────────────────────────────────────────────────────────────────────

export interface SettleResult {
  legsSettled: number;
  slipsSettled: number;
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

    const actualValue = (stat as unknown as Record<string, number | null>)[
      leg.statType
    ];
    if (actualValue == null) continue;

    // Legs are stored as "over the line" bets.
    const result = actualValue > leg.line ? "hit" : "miss";
    await db
      .update(betLegs)
      .set({ result, actualValue })
      .where(eq(betLegs.id, leg.id));
    legsSettled++;
    touchedBetIds.add(leg.betId);
  }

  const slipsSettled = await rollUpSlips([...touchedBetIds]);
  return { legsSettled, slipsSettled };
}

/** Mark a slip won only if every leg hit; lost if any leg missed. */
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
    const anyPending = legList.some((l) => l.result === "pending");
    if (anyPending) continue;
    const anyMiss = legList.some((l) => l.result === "miss");
    const status = anyMiss ? "lost" : "won";
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
 * Fill in actual values for legs that settled by result (e.g. from a screenshot
 * with the tick but no readable number) once AFL Tables publishes the official
 * figure. Only touches already-settled legs whose actualValue is still missing —
 * it never changes a result or overwrites a number we already have.
 */
export async function backfillSettledActuals(): Promise<number> {
  const legs = await db
    .select()
    .from(betLegs)
    .where(
      and(
        inArray(betLegs.result, ["hit", "miss"]),
        isNull(betLegs.actualValue),
      ),
    );

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
    if (actualValue == null) continue;
    await db
      .update(betLegs)
      .set({ actualValue })
      .where(eq(betLegs.id, leg.id));
    filled++;
  }
  return filled;
}

export interface SettlementPipelineResult {
  sync: Awaited<ReturnType<typeof syncFixtures>>;
  statsRecorded: number;
  settle: SettleResult;
  actualsBackfilled: number;
  accuracyRows: number;
}

/**
 * The full morning-after pipeline: refresh results from Squiggle, pull actual
 * player stats from AFL Tables for every completed game, settle pending legs
 * against those actuals, then recompute model accuracy for affected rounds.
 * Shared by the daily cron and the "Settle now" button. Pass `gameIds` to
 * scope the (slow, scraping) stats step to just those games — the manual
 * button uses this so it only touches the games your pending bets reference
 * and finishes well inside the serverless time limit. The unscoped cron run
 * sweeps every completed game.
 */
export async function runSettlementPipeline(
  opts: { gameIds?: number[] } = {},
): Promise<SettlementPipelineResult> {
  const season = currentSeason();
  const sync = await syncFixtures(season);

  const completedAll = await db
    .select({ id: games.id, round: games.round })
    .from(games)
    .where(eq(games.status, "complete"));
  const completed =
    opts.gameIds == null
      ? completedAll
      : completedAll.filter((g) => opts.gameIds!.includes(g.id));

  let statsRecorded = 0;
  const rounds = new Set<number>();
  for (const g of completed) {
    const res = await settleGamePlayerStats(g.id);
    statsRecorded += res.recorded;
    if (g.round != null && res.recorded > 0) rounds.add(g.round);
  }

  const settle = await settlePendingBets();
  const actualsBackfilled = await backfillSettledActuals();

  let accuracyRows = 0;
  for (const round of rounds) {
    const acc = await computeRoundAccuracy(season, round);
    accuracyRows += acc.rowsWritten;
  }

  return { sync, statsRecorded, settle, actualsBackfilled, accuracyRows };
}
