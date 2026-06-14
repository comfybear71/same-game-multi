import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookmakerLines, games, players, predictions } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { canonicalVenue } from "@/lib/afl/venues";
import { getPlayerHistory } from "@/lib/ingest/aflTables";
import { runAllModels } from "./engine";
import { buildInputs } from "./features";
import { DEFAULT_PARAMS } from "./types";

// Generate and persist Models A/B/C predictions for every player who has a
// bookmaker prop line on a game. Team/opponent/venue come from AFL Tables
// history; players we can't resolve are skipped (their line is still stored).

export interface GenerateResult {
  gameId: number;
  playersProcessed: number;
  predictionsWritten: number;
  unresolved: string[];
}

async function upsertPlayer(name: string, team: string): Promise<number> {
  const existing = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.name, name), eq(players.team, team)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await db
    .insert(players)
    .values({ name, team })
    .onConflictDoNothing()
    .returning({ id: players.id });
  if (inserted[0]) return inserted[0].id;
  // Race / conflict: re-read.
  const again = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.name, name), eq(players.team, team)))
    .limit(1);
  return again[0].id;
}

export async function generatePredictions(gameId: number): Promise<GenerateResult> {
  const game = (await db.select().from(games).where(eq(games.id, gameId)).limit(1))[0];
  if (!game) throw new Error(`game ${gameId} not found`);

  const season = game.season ?? new Date().getUTCFullYear();
  const venue = canonicalVenue(game.venue);
  const homeC = canonicalTeam(game.home) ?? game.home;
  const awayC = canonicalTeam(game.away) ?? game.away;

  // Distinct propped players for this game.
  const lineRows = await db
    .select({ name: bookmakerLines.playerName })
    .from(bookmakerLines)
    .where(eq(bookmakerLines.gameId, gameId));
  const names = [...new Set(lineRows.map((r) => r.name))];

  let predictionsWritten = 0;
  const unresolved: string[] = [];
  let playersProcessed = 0;

  for (const name of names) {
    const history = await getPlayerHistory(name);
    if (history.gameLog.length === 0 || !history.team) {
      unresolved.push(name);
      continue;
    }

    // Opponent = the team this player is NOT on.
    let opponent: string | null = null;
    if (history.team === homeC) opponent = awayC;
    else if (history.team === awayC) opponent = homeC;

    const playerId = await upsertPlayer(name, history.team);

    // Backfill bookmaker line player ids.
    await db
      .update(bookmakerLines)
      .set({ playerId })
      .where(and(eq(bookmakerLines.gameId, gameId), eq(bookmakerLines.playerName, name)));

    const inputs = buildInputs(history, {
      season,
      opponent,
      venue,
      formWindow: DEFAULT_PARAMS.formWindow,
    });

    for (const input of inputs) {
      const outputs = runAllModels(input, DEFAULT_PARAMS);
      for (const out of outputs) {
        await db
          .insert(predictions)
          .values({
            playerId,
            gameId,
            statType: out.statType,
            model: out.model,
            predictedValue: out.predictedValue,
          })
          .onConflictDoUpdate({
            target: [
              predictions.playerId,
              predictions.gameId,
              predictions.statType,
              predictions.model,
            ],
            set: { predictedValue: out.predictedValue, createdAt: new Date() },
          });
        predictionsWritten++;
      }
    }
    playersProcessed++;
  }

  return { gameId, playersProcessed, predictionsWritten, unresolved };
}
