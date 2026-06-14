import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { betLegs, bets, users, type Bet, type BetLeg } from "@/db/schema";

export interface BetWithLegs extends Bet {
  legs: BetLeg[];
}

/** Resolve our internal user id from the session email. */
export async function userIdForEmail(email: string): Promise<number | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** All of a user's bets with their legs, newest first. */
export async function getBetsForUser(userId: number): Promise<BetWithLegs[]> {
  const slips = await db
    .select()
    .from(bets)
    .where(eq(bets.userId, userId))
    .orderBy(desc(bets.createdAt));

  if (slips.length === 0) return [];

  const result: BetWithLegs[] = [];
  for (const slip of slips) {
    const legs = await db
      .select()
      .from(betLegs)
      .where(eq(betLegs.betId, slip.id));
    result.push({ ...slip, legs });
  }
  return result;
}

export interface UserGameLeg {
  betId: number;
  playerName: string | null;
  statType: string;
  line: number;
  odds: number | null;
  result: string;
}

/** A user's bet legs that reference a given game (for the live "your legs" panel). */
export async function getUserLegsForGame(
  userId: number,
  gameId: number,
): Promise<UserGameLeg[]> {
  const rows = await db
    .select({
      betId: betLegs.betId,
      playerName: betLegs.playerName,
      statType: betLegs.statType,
      line: betLegs.line,
      odds: betLegs.odds,
      result: betLegs.result,
    })
    .from(betLegs)
    .innerJoin(bets, eq(betLegs.betId, bets.id))
    .where(and(eq(bets.userId, userId), eq(betLegs.gameId, gameId)));
  return rows;
}

export interface BetSummary {
  total: number;
  pending: number;
  won: number;
  lost: number;
  staked: number;
  returned: number;
  roi: number | null;
}

export function summarise(slips: BetWithLegs[]): BetSummary {
  let staked = 0;
  let returned = 0;
  // ROI is computed over SETTLED bets only — pending stakes don't count as
  // losses (that's why a fresh pending bet must not show -100%).
  let settledStake = 0;
  const counts = { pending: 0, won: 0, lost: 0 };
  for (const s of slips) {
    const stake = s.totalStake ?? 0;
    staked += stake;
    if (s.status === "won") {
      counts.won++;
      settledStake += stake;
      returned += stake * (s.totalOdds ?? 0);
    } else if (s.status === "lost") {
      counts.lost++;
      settledStake += stake;
    } else if (s.status === "pending") {
      counts.pending++;
    }
  }
  const roi = settledStake > 0 ? (returned - settledStake) / settledStake : null;
  return {
    total: slips.length,
    pending: counts.pending,
    won: counts.won,
    lost: counts.lost,
    staked,
    returned,
    roi,
  };
}
