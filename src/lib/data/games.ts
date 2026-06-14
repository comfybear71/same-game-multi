import { and, asc, desc, eq, gte, lt, lte, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { games, type Game } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";

// Read helpers for the UI. Server-only.

/**
 * Games that have started recently but aren't marked complete — candidates for
 * "in play". The live score/clock is confirmed per-game from Squiggle in the UI.
 */
export async function getInPlayGames(): Promise<Game[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  return db
    .select()
    .from(games)
    .where(
      and(
        gte(games.commenceTime, windowStart),
        lte(games.commenceTime, now),
        ne(games.status, "complete"),
      ),
    )
    .orderBy(asc(games.commenceTime));
}

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

/** Find a game by its two team names (any order) — most recent match. */
export async function findGameByTeams(
  teamA: string | null,
  teamB: string | null,
): Promise<number | null> {
  const a = canonicalTeam(teamA);
  const b = canonicalTeam(teamB);
  if (!a || !b) return null;
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .where(
      or(
        and(eq(games.home, a), eq(games.away, b)),
        and(eq(games.home, b), eq(games.away, a)),
      ),
    )
    .orderBy(desc(games.commenceTime))
    .limit(1);
  return rows[0]?.id ?? null;
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
