import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { betLegs, bets, games, playerGameStats } from "@/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Settlement: once a game is complete and player stats are recorded, mark each
// bet leg hit/miss, then roll up each slip to won/lost.
//
// Player stat ingestion (AFL Tables) is stubbed in v1, so legs settle only when
// a matching `player_game_stats` row exists and is `settled`. Until then legs
// stay "pending" and this runs harmlessly. See HANDOFF.md.
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
async function rollUpSlips(betIds: number[]): Promise<number> {
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

/** Convenience: how many completed games still lack settled player stats. */
export async function gamesAwaitingStats(): Promise<number> {
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.status, "complete"));
  return rows.length;
}
