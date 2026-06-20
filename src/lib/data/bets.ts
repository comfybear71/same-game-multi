import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  betLegs,
  bets,
  players,
  predictions,
  users,
  type Bet,
  type BetLeg,
} from "@/db/schema";

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

export interface BetTrackerLeg {
  playerName: string | null;
  jumper: number | null;
  team: string | null;
  statType: string;
  line: number;
  odds: number | null;
  result: string;
  prediction: number | null; // our Model C view, as a live proxy
}

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The user's legs that belong to a game — matched by leg.gameId OR (for legs
 * that weren't linked to a game) by player name against the game's predicted
 * players, scoped to the same round. The round scope matters: a player turns
 * up in this game's predicted roster most weeks, so without it an unlinked
 * leg from an old round leaks into every later game he plays — i.e. stale
 * bets showing up on this week's page. Enriched with jumper/team/our
 * prediction for the live "your bets" panel.
 */
export async function getUserBetTracker(
  userId: number,
  gameId: number,
  round: number | null = null,
): Promise<BetTrackerLeg[]> {
  const gamePlayers = await db
    .select({
      name: players.name,
      jumper: players.jumper,
      team: players.team,
      statType: predictions.statType,
      value: predictions.predictedValue,
    })
    .from(predictions)
    .innerJoin(players, eq(predictions.playerId, players.id))
    .where(and(eq(predictions.gameId, gameId), eq(predictions.model, "C")));

  const meta = new Map<string, { jumper: number | null; team: string }>();
  const predByKey = new Map<string, number>();
  const gameNames = new Set<string>();
  for (const p of gamePlayers) {
    const n = normaliseName(p.name);
    gameNames.add(n);
    meta.set(n, { jumper: p.jumper, team: p.team });
    predByKey.set(`${n}:${p.statType}`, p.value);
  }

  const legs = await db
    .select({
      playerName: betLegs.playerName,
      gameId: betLegs.gameId,
      betRound: bets.round,
      statType: betLegs.statType,
      line: betLegs.line,
      odds: betLegs.odds,
      result: betLegs.result,
    })
    .from(betLegs)
    .innerJoin(bets, eq(betLegs.betId, bets.id))
    .where(eq(bets.userId, userId));

  const out: BetTrackerLeg[] = [];
  for (const leg of legs) {
    const n = leg.playerName ? normaliseName(leg.playerName) : "";
    const sameRound = round != null && leg.betRound === round;
    const belongs =
      leg.gameId === gameId || (leg.gameId == null && sameRound && gameNames.has(n));
    if (!belongs) continue;
    const m = meta.get(n);
    out.push({
      playerName: leg.playerName,
      jumper: m?.jumper ?? null,
      team: m?.team ?? null,
      statType: leg.statType,
      line: leg.line,
      odds: leg.odds,
      result: leg.result,
      prediction: predByKey.get(`${n}:${leg.statType}`) ?? null,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Player betting record — the "learning" layer. Across all of a user's settled
// legs, how each player has gone against the lines you've backed: how often they
// cleared it, the average line vs average actual, and the most recent result
// ("last time you had him for 20.5 he got 19"). Surfaced on the bet tracker and
// inline on the game board when you're about to back him again.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerBetRecord {
  playerName: string;
  statType: string;
  bets: number; // settled legs (hit + miss)
  hits: number;
  misses: number;
  avgLine: number;
  avgActual: number | null;
  lastLine: number;
  lastActual: number | null;
  lastResult: "hit" | "miss";
}

export interface PlayerRecordIndex {
  list: PlayerBetRecord[]; // most-bet first
  byKey: Record<string, PlayerBetRecord>; // key = `${normalisedName}:${stat}`
}

/** Lookup key for a player's record on a given stat. Mirror in any client. */
export function playerRecordKey(name: string, stat: string): string {
  return `${normaliseName(name)}:${stat}`;
}

/** Aggregate a user's settled legs into a per-player, per-stat record. */
export async function getPlayerBettingRecord(
  userId: number,
): Promise<PlayerRecordIndex> {
  // Newest first so the first leg we see per key is the most recent.
  const legs = await db
    .select({
      playerName: betLegs.playerName,
      statType: betLegs.statType,
      line: betLegs.line,
      actualValue: betLegs.actualValue,
      result: betLegs.result,
    })
    .from(betLegs)
    .innerJoin(bets, eq(betLegs.betId, bets.id))
    .where(and(eq(bets.userId, userId), inArray(betLegs.result, ["hit", "miss"])))
    .orderBy(desc(betLegs.createdAt));

  interface Acc {
    name: string;
    stat: string;
    bets: number;
    hits: number;
    lineSum: number;
    actualSum: number;
    actualN: number;
    lastLine: number;
    lastActual: number | null;
    lastResult: "hit" | "miss";
  }
  const acc = new Map<string, Acc>();

  for (const leg of legs) {
    if (!leg.playerName) continue; // unnamed legs can't build a player record
    const key = playerRecordKey(leg.playerName, leg.statType);
    let a = acc.get(key);
    if (!a) {
      a = {
        name: leg.playerName,
        stat: leg.statType,
        bets: 0,
        hits: 0,
        lineSum: 0,
        actualSum: 0,
        actualN: 0,
        lastLine: leg.line,
        lastActual: leg.actualValue,
        lastResult: leg.result as "hit" | "miss",
      };
      acc.set(key, a);
    }
    a.bets++;
    if (leg.result === "hit") a.hits++;
    a.lineSum += leg.line;
    if (leg.actualValue != null) {
      a.actualSum += leg.actualValue;
      a.actualN++;
    }
  }

  const byKey: Record<string, PlayerBetRecord> = {};
  const list: PlayerBetRecord[] = [];
  for (const [key, a] of acc) {
    const rec: PlayerBetRecord = {
      playerName: a.name,
      statType: a.stat,
      bets: a.bets,
      hits: a.hits,
      misses: a.bets - a.hits,
      avgLine: a.lineSum / a.bets,
      avgActual: a.actualN > 0 ? a.actualSum / a.actualN : null,
      lastLine: a.lastLine,
      lastActual: a.lastActual,
      lastResult: a.lastResult,
    };
    byKey[key] = rec;
    list.push(rec);
  }
  list.sort((x, y) => y.bets - x.bets || x.playerName.localeCompare(y.playerName));
  return { list, byKey };
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
