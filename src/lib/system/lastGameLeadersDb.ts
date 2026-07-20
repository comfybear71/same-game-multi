/**
 * Load last-game leader rows for a fixture (both clubs' previous completed games).
 */

import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { games, playerGameStats, players } from "@/db/schema";
import {
  leadersByKey,
  rankLastGameLeaders,
  type LastGameLeader,
  type PrevGameStatRow,
} from "@/lib/system/lastGameLeaders";

async function previousCompletedGameId(
  team: string,
  before: Date,
): Promise<number | null> {
  const [row] = await db
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        or(eq(games.home, team), eq(games.away, team)),
        eq(games.status, "complete"),
        lt(games.commenceTime, before),
      ),
    )
    .orderBy(desc(games.commenceTime))
    .limit(1);
  return row?.id ?? null;
}

async function statsForGame(gameId: number): Promise<PrevGameStatRow[]> {
  const rows = await db
    .select({
      playerId: playerGameStats.playerId,
      team: players.team,
      disposals: playerGameStats.disposals,
      marks: playerGameStats.marks,
      tackles: playerGameStats.tackles,
      goals: playerGameStats.goals,
    })
    .from(playerGameStats)
    .innerJoin(players, eq(players.id, playerGameStats.playerId))
    .where(
      and(
        eq(playerGameStats.gameId, gameId),
        sql`coalesce(${playerGameStats.didPlay}, true) = true`,
      ),
    );

  return rows.map((r) => ({
    playerId: r.playerId,
    team: r.team,
    disposals: r.disposals,
    marks: r.marks,
    tackles: r.tackles,
    goals: r.goals,
  }));
}

/**
 * Top-3 leaders per stat from home + away clubs' previous completed games.
 * Returns [] when either club has no prior completed game / no stats.
 */
export async function loadLastGameLeaders(
  gameId: number,
): Promise<LastGameLeader[]> {
  const [game] = await db
    .select({
      home: games.home,
      away: games.away,
      commenceTime: games.commenceTime,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (!game) return [];

  const [homePrev, awayPrev] = await Promise.all([
    previousCompletedGameId(game.home, game.commenceTime),
    previousCompletedGameId(game.away, game.commenceTime),
  ]);

  const prevIds = [homePrev, awayPrev].filter(
    (id): id is number => id != null,
  );
  if (prevIds.length === 0) return [];

  const batches = await Promise.all(prevIds.map((id) => statsForGame(id)));
  const pooled = batches.flat();
  return rankLastGameLeaders(pooled);
}

export async function loadLastGameLeadersMap(
  gameId: number,
): Promise<Map<string, LastGameLeader>> {
  return leadersByKey(await loadLastGameLeaders(gameId));
}
