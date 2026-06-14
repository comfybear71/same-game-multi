import { and, asc, desc, eq, gte, lt } from "drizzle-orm";

import { db } from "@/db";
import { games, type Game } from "@/db/schema";

// Read helpers for the UI. Server-only.

/** Next upcoming (scheduled or in-progress) game by commence time. */
export async function getNextGame(): Promise<Game | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(games)
    .where(gte(games.commenceTime, now))
    .orderBy(asc(games.commenceTime))
    .limit(1);
  return rows[0] ?? null;
}

/** Upcoming games (optionally capped), soonest first. */
export async function getUpcomingGames(limit = 18): Promise<Game[]> {
  const now = new Date();
  return db
    .select()
    .from(games)
    .where(gte(games.commenceTime, now))
    .orderBy(asc(games.commenceTime))
    .limit(limit);
}

/** Most recent completed games, newest first. */
export async function getRecentResults(limit = 9): Promise<Game[]> {
  const now = new Date();
  return db
    .select()
    .from(games)
    .where(and(lt(games.commenceTime, now), eq(games.status, "complete")))
    .orderBy(desc(games.commenceTime))
    .limit(limit);
}

export async function getGameById(id: number): Promise<Game | null> {
  const rows = await db.select().from(games).where(eq(games.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Games for a given round (for round-level dashboards). */
export async function getGamesByRound(
  season: number,
  round: number,
): Promise<Game[]> {
  return db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.round, round)))
    .orderBy(asc(games.commenceTime));
}
