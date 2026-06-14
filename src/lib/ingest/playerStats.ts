import { eq } from "drizzle-orm";

import { db } from "@/db";
import { games, players, playerGameStats } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { actualForGame } from "@/lib/predictions/features";
import { getPlayerHistory } from "./aflTables";

// After a game completes, pull each predicted player's actual stat line from
// AFL Tables (the game appears in their game log within a day or two) and write
// it to player_game_stats. This powers bet settlement and the accuracy
// scorecard. Degrades gracefully: players whose actuals aren't up yet are left
// for the next run.

export interface PlayerStatsResult {
  gameId: number;
  recorded: number;
  pending: number;
}

/** Settle actual player stats for one completed game. */
export async function settleGamePlayerStats(gameId: number): Promise<PlayerStatsResult> {
  const game = (await db.select().from(games).where(eq(games.id, gameId)).limit(1))[0];
  if (!game || game.status !== "complete" || game.round == null) {
    return { gameId, recorded: 0, pending: 0 };
  }

  const homeC = canonicalTeam(game.home) ?? game.home;
  const awayC = canonicalTeam(game.away) ?? game.away;
  const season = game.season ?? new Date().getUTCFullYear();

  // Players we generated predictions for are the ones we care about settling.
  const rows = await db
    .select({ id: players.id, name: players.name, team: players.team })
    .from(players);

  // Restrict to players on either side of this game.
  const involved = rows.filter((p) => {
    const t = canonicalTeam(p.team) ?? p.team;
    return t === homeC || t === awayC;
  });

  let recorded = 0;
  let pending = 0;

  for (const p of involved) {
    const t = canonicalTeam(p.team) ?? p.team;
    const opponent = t === homeC ? awayC : homeC;
    const history = await getPlayerHistory(p.name);
    const actual = actualForGame(history.gameLog, season, String(game.round), opponent);
    if (!actual) {
      pending++;
      continue;
    }
    await db
      .insert(playerGameStats)
      .values({
        playerId: p.id,
        gameId,
        disposals: actual.disposals,
        marks: actual.marks,
        tackles: actual.tackles,
        goals: actual.goals,
        didPlay: true,
        settled: true,
      })
      .onConflictDoUpdate({
        target: [playerGameStats.playerId, playerGameStats.gameId],
        set: {
          disposals: actual.disposals,
          marks: actual.marks,
          tackles: actual.tackles,
          goals: actual.goals,
          didPlay: true,
          settled: true,
        },
      });
    recorded++;
  }

  return { gameId, recorded, pending };
}
