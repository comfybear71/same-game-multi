import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  betLegs,
  bets,
  games,
  playerGameStats,
  playerLiveStats,
  players,
  systemTickets,
  type LegResult,
} from "@/db/schema";
import { currentSeason } from "@/lib/cron";
import { gamePlayerNameSet, legInGameScope, slipBetIdsForGame, type LegGameScope } from "@/lib/data/bets";
import { statValueFromRow, settlementStatValue, MC_AUTHORITATIVE_MIN_PLAYERS } from "@/lib/data/liveStatsForGame";
import { resolveAflMatchIdForGame } from "@/lib/ingest/aflMatchForGame";
import { settleGamePlayerStats, applyMatchCentreToPlayerGameStats } from "@/lib/ingest/playerStats";
import { refreshGameFromSquiggle, syncFixtures } from "@/lib/ingest/sync";
import { normalisePlayerName } from "@/lib/playerName";
import { computeRoundAccuracy } from "@/lib/predictions/accuracy";
import { gradeSystemBookForGame } from "@/lib/system/grade";

// ─────────────────────────────────────────────────────────────────────────────
// Settlement: once a game is complete and player stats are recorded, mark each
// bet leg hit/miss, then roll up each slip to won/lost.
//
// Legs settle automatically from Match Centre (official AFL feed) after full
// time — each player × stat graded against the line; no manual stat checking.
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

/** Pending + settled legs in game scope — re-hydrate when MC/AFL Tables corrects actuals. */
async function legsForGameSettlement(gameId: number): Promise<BetLegRow[]> {
  const pending = await pendingLegsForGame(gameId);
  const game = (
    await db.select({ round: games.round }).from(games).where(eq(games.id, gameId)).limit(1)
  )[0];
  if (!game) return pending;

  const gameNames = await gamePlayerNameSet(gameId);
  const rows = await db
    .select({ leg: betLegs, betRound: bets.round, betId: bets.id })
    .from(betLegs)
    .innerJoin(bets, eq(betLegs.betId, bets.id))
    .where(inArray(betLegs.result, ["miss", "hit"]));

  const scopeLegs: LegGameScope[] = rows.map(({ leg, betRound, betId }) => ({
    betId,
    gameId: leg.gameId,
    playerName: leg.playerName,
    betRound,
  }));
  const slipBetIds = slipBetIdsForGame(scopeLegs, gameId, game.round, gameNames);

  const settled = rows
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

  const seen = new Set<number>();
  const out: BetLegRow[] = [];
  for (const leg of [...pending, ...settled]) {
    if (seen.has(leg.id)) continue;
    seen.add(leg.id);
    out.push(leg);
  }
  return out;
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

    const wasWrongZero =
      leg.result === "miss" &&
      (leg.actualValue === 0 || leg.actualValue == null);
    const result: LegResult =
      wasWrongZero && actualValue != null
        ? actualValue > leg.line
          ? "hit"
          : "miss"
        : leg.result;

    await db
      .update(betLegs)
      .set({ actualValue, result })
      .where(eq(betLegs.id, leg.id));
    filled++;
    if (result !== leg.result) {
      await rollUpSlips([leg.betId]);
    }
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

/** Fill actualValue from Match Centre (authoritative) with AFL Tables fallback only when MC incomplete. */
export async function hydrateGameLegActuals(gameId: number): Promise<number> {
  const legs = await legsForGameSettlement(gameId);
  if (legs.length === 0) return 0;

  const game = (
    await db.select().from(games).where(eq(games.id, gameId)).limit(1)
  )[0];
  if (!game) return 0;

  const officialRows = await db
    .select({
      stat: playerGameStats,
      name: players.name,
    })
    .from(playerGameStats)
    .innerJoin(players, eq(players.id, playerGameStats.playerId))
    .where(
      and(eq(playerGameStats.gameId, gameId), eq(playerGameStats.settled, true)),
    );

  const officialByPlayerId = new Map(
    officialRows.map((r) => [r.stat.playerId, r.stat]),
  );
  const officialByName = new Map<string, (typeof officialRows)[0]["stat"]>();
  for (const row of officialRows) {
    officialByName.set(normalisePlayerName(row.name), row.stat);
  }

  const mcByName = new Map<
    string,
    { disposals: number; marks: number; goals: number; tackles: number }
  >();
  let mcRowCount = 0;
  const aflMatchId = await resolveAflMatchIdForGame(game);
  if (aflMatchId) {
    const liveRows = await db
      .select()
      .from(playerLiveStats)
      .where(eq(playerLiveStats.matchId, aflMatchId));
    mcRowCount = liveRows.length;
    for (const row of liveRows) {
      mcByName.set(normalisePlayerName(row.playerName), {
        disposals: row.disposals,
        marks: row.marks,
        goals: row.goals,
        tackles: row.tackles,
      });
    }
  }
  const mcAuthoritative = mcRowCount >= MC_AUTHORITATIVE_MIN_PLAYERS;

  let hydrated = 0;
  const touchedBetIds = new Set<number>();
  const pgsMcFix = new Map<
    number,
    { disposals?: number; marks?: number; goals?: number; tackles?: number }
  >();

  for (const leg of legs) {
    let officialVal: number | null = null;

    if (leg.playerId != null) {
      const stat = officialByPlayerId.get(leg.playerId);
      if (stat) officialVal = statValueFromRow(leg.statType, stat);
    }

    if (officialVal == null && leg.playerName) {
      const stat = officialByName.get(normalisePlayerName(leg.playerName));
      if (stat) officialVal = statValueFromRow(leg.statType, stat);
    }

    let mcVal: number | null = null;
    if (leg.playerName) {
      const mc = mcByName.get(normalisePlayerName(leg.playerName));
      if (mc) mcVal = statValueFromRow(leg.statType, mc);
    }

    const value = settlementStatValue(mcVal, officialVal, { mcAuthoritative });
    if (value == null) continue;

    if (leg.playerId != null && mcVal != null && officialVal != null && mcVal !== officialVal) {
      const fix = pgsMcFix.get(leg.playerId) ?? {};
      if (leg.statType === "disposals") fix.disposals = mcVal;
      if (leg.statType === "marks") fix.marks = mcVal;
      if (leg.statType === "goals") fix.goals = mcVal;
      if (leg.statType === "tackles") fix.tackles = mcVal;
      pgsMcFix.set(leg.playerId, fix);
    }

    const result: LegResult = value > leg.line ? "hit" : "miss";
    const unchanged =
      leg.actualValue === value && leg.result === result;
    if (unchanged) continue;

    await db
      .update(betLegs)
      .set({
        actualValue: value,
        result,
        ...(leg.gameId == null ? { gameId } : {}),
      })
      .where(eq(betLegs.id, leg.id));
    hydrated++;
    touchedBetIds.add(leg.betId);
  }

  for (const [playerId, patch] of pgsMcFix) {
    await db
      .update(playerGameStats)
      .set(patch)
      .where(
        and(
          eq(playerGameStats.gameId, gameId),
          eq(playerGameStats.playerId, playerId),
        ),
      );
  }

  if (touchedBetIds.size > 0) {
    await rollUpSlips([...touchedBetIds]);
  }

  return hydrated;
}

/** Finalise pending legs from stored actualValue (after hydrate). */
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
  hydrated: number;
  fromStats: SettleResult;
  fromLive: SettleResult;
  systemBook: { ticketsGraded: number; legsUpdated: number };
}

/** Post-game: Squiggle → MC sync → MC → PGS → hydrate legs → grade. */
export async function runGameOverSettlement(gameId: number): Promise<GameOverSettlement> {
  const game = (
    await db.select().from(games).where(eq(games.id, gameId)).limit(1)
  )[0];
  if (!game) throw new Error("game not found");

  await refreshGameFromSquiggle(gameId).catch((err) => {
    console.warn(`[game-over] Squiggle refresh for game ${gameId}:`, err);
  });

  const { syncLiveStatsForGame } = await import("@/lib/ingest/liveStatsSync");
  await syncLiveStatsForGame(gameId, { final: true }).catch((err) => {
    console.warn(`[game-over] final MC sync for game ${gameId}:`, err);
  });

  await applyMatchCentreToPlayerGameStats(gameId).catch((err) => {
    console.warn(`[game-over] MC → PGS for game ${gameId}:`, err);
  });

  const statsResult = await settleGamePlayerStats(gameId);
  const hydrated = await hydrateGameLegActuals(gameId);
  const fromLive = await settleLegsFromLiveCounts(gameId);
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
    hydrated,
    fromStats,
    fromLive,
    systemBook,
  };
}

/**
 * Re-sync Match Centre and re-grade all legs for a complete game.
 * Safe to call on every page load — idempotent when DB already matches MC.
 */
export async function ensureAccurateGameSettlement(gameId: number): Promise<number> {
  const game = (
    await db.select({ status: games.status }).from(games).where(eq(games.id, gameId)).limit(1)
  )[0];
  if (!game || game.status !== "complete") return 0;

  const { syncLiveStatsForGame } = await import("@/lib/ingest/liveStatsSync");
  await syncLiveStatsForGame(gameId, { final: true }).catch((err) => {
    console.warn(`[settle] MC sync for game ${gameId}:`, err);
  });
  await applyMatchCentreToPlayerGameStats(gameId).catch((err) => {
    console.warn(`[settle] MC → PGS for game ${gameId}:`, err);
  });
  return hydrateGameLegActuals(gameId);
}

const POST_GAME_AUTO_SETTLE_MS = 12 * 60 * 60 * 1000;

/**
 * After siren: auto-sync MC and grade every leg for recently complete fixtures.
 * Called by the live-stats cron (every 2 min) so mates never manually check stats.
 */
export async function autoSettleRecentCompleteGames(
  season: number,
): Promise<{ gamesChecked: number; legsHydrated: number }> {
  const windowStart = new Date(Date.now() - POST_GAME_AUTO_SETTLE_MS);
  const recentComplete = await db
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        eq(games.season, season),
        eq(games.status, "complete"),
        gte(games.commenceTime, windowStart),
      ),
    );

  let legsHydrated = 0;
  for (const { id } of recentComplete) {
    legsHydrated += await ensureAccurateGameSettlement(id);
  }
  return { gamesChecked: recentComplete.length, legsHydrated };
}

export interface SettlementPipelineResult {
  sync: Awaited<ReturnType<typeof syncFixtures>>;
  statsRecorded: number;
  legsHydrated: number;
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
  let legsHydrated = 0;
  const rounds = new Set<number>();
  const { syncLiveStatsForGame } = await import("@/lib/ingest/liveStatsSync");
  for (const g of completed) {
    await syncLiveStatsForGame(g.id, { final: true }).catch((err) => {
      console.warn(`[settle] MC sync for game ${g.id}:`, err);
    });
    await applyMatchCentreToPlayerGameStats(g.id).catch((err) => {
      console.warn(`[settle] MC → PGS for game ${g.id}:`, err);
    });
    const res = await settleGamePlayerStats(g.id);
    statsRecorded += res.recorded;
    if (g.round != null && (res.recorded > 0 || res.skipped > 0)) {
      rounds.add(g.round);
    }
    legsHydrated += await hydrateGameLegActuals(g.id);
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
    legsHydrated,
    settle,
    actualsBackfilled,
    accuracyRows,
    systemTicketsGraded,
    lab,
    bankrollRunId,
  };
}
