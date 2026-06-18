import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  bookmakerLines,
  games,
  players,
  playerGameFeatures,
  predictions,
} from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { canonicalVenue } from "@/lib/afl/venues";
import { getPlayerCalibration } from "@/lib/data/calibration";
import { getPlayerHistory, type PlayerHistory } from "@/lib/ingest/aflTables";
import { getTeamSeasonStats } from "@/lib/ingest/wheelo";
import { calKey } from "./calibration";
import { runAllModels } from "./engine";
import { buildInputs, buildStatFeatures, STAT_TYPES } from "./features";
import { matchupFactor, teamRatios } from "./teamMatchup";
import { DEFAULT_PARAMS } from "./types";

// Generate and persist Models A/B/C predictions for every player who has a
// bookmaker prop line on a game. Team/opponent/venue come from AFL Tables
// history. Players we can't resolve are skipped (their line is still stored).
//
// Performance: histories are fetched concurrently (each is a ~270KB page) and
// all predictions are written in a single batched upsert, so the first
// (uncached) run completes within the serverless time budget. Subsequent runs
// read cached HTML and are fast.

export interface GenerateResult {
  gameId: number;
  playersProcessed: number;
  predictionsWritten: number;
  unresolved: string[];
}

/** Run an async mapper over items with bounded concurrency. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
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
  if (names.length === 0) {
    return { gameId, playersProcessed: 0, predictionsWritten: 0, unresolved: [] };
  }

  // Fetch all histories concurrently (bounded).
  const fetched = await mapLimit(names, 5, async (name) => ({
    name,
    history: await getPlayerHistory(name),
  }));

  const resolved = fetched.filter(
    (f): f is { name: string; history: PlayerHistory & { team: string } } =>
      f.history.gameLog.length > 0 && !!f.history.team,
  );
  const unresolved = fetched
    .filter((f) => f.history.gameLog.length === 0 || !f.history.team)
    .map((f) => f.name);

  if (resolved.length === 0) {
    return { gameId, playersProcessed: 0, predictionsWritten: 0, unresolved };
  }

  // Batch-upsert players (incl. guernsey number), then look up ids in one query.
  await db
    .insert(players)
    .values(
      resolved.map((r) => ({
        name: r.name,
        team: r.history.team,
        jumper: r.history.jumper,
      })),
    )
    .onConflictDoUpdate({
      target: [players.name, players.team],
      set: { jumper: sql`excluded.jumper` },
    });
  const playerRows = await db
    .select({ id: players.id, name: players.name, team: players.team })
    .from(players)
    .where(inArray(players.name, resolved.map((r) => r.name)));
  const idByKey = new Map<string, number>();
  for (const row of playerRows) idByKey.set(`${row.name}|${row.team}`, row.id);

  // One team-stats fetch for the whole game (Wheelo season aggregates, for + against).
  const ratios = teamRatios(await getTeamSeasonStats(season));

  // Per-player calibration from this game's players' track record (Model B vs actuals).
  const calibration = await getPlayerCalibration([...idByKey.values()]);

  // Build prediction + feature rows, backfill bookmaker line player ids.
  const predRows: (typeof predictions.$inferInsert)[] = [];
  const featureRows: (typeof playerGameFeatures.$inferInsert)[] = [];
  for (const { name, history } of resolved) {
    const playerId = idByKey.get(`${name}|${history.team}`);
    if (!playerId) continue;

    await db
      .update(bookmakerLines)
      .set({ playerId })
      .where(and(eq(bookmakerLines.gameId, gameId), eq(bookmakerLines.playerName, name)));

    const opponent =
      history.team === homeC ? awayC : history.team === awayC ? homeC : null;

    const teamFactors = Object.fromEntries(
      STAT_TYPES.map((stat) => [stat, matchupFactor(ratios, history.team, opponent, stat)]),
    ) as Record<(typeof STAT_TYPES)[number], number>;

    const playerFactors = Object.fromEntries(
      STAT_TYPES.map((stat) => [stat, calibration.get(calKey(playerId, stat))?.factor ?? 1]),
    ) as Record<(typeof STAT_TYPES)[number], number>;

    const inputs = buildInputs(history, {
      season,
      opponent,
      venue,
      formWindow: DEFAULT_PARAMS.formWindow,
      teamFactors,
      playerFactors,
    });
    for (const input of inputs) {
      for (const out of runAllModels(input, DEFAULT_PARAMS)) {
        predRows.push({
          playerId,
          gameId,
          statType: out.statType,
          model: out.model,
          predictedValue: out.predictedValue,
        });
      }
    }

    for (const f of buildStatFeatures(history, season, opponent)) {
      featureRows.push({
        playerId,
        gameId,
        statType: f.statType,
        seasonAverage: f.seasonAverage,
        recentForm: f.recentForm,
        vsOpponentAvg: f.vsOpponentAvg,
        vsOpponentGames: f.vsOpponentGames,
      });
    }
  }

  // Single batched upsert for all predictions.
  if (predRows.length > 0) {
    await db
      .insert(predictions)
      .values(predRows)
      .onConflictDoUpdate({
        target: [
          predictions.playerId,
          predictions.gameId,
          predictions.statType,
          predictions.model,
        ],
        set: {
          predictedValue: sql`excluded.predicted_value`,
          createdAt: new Date(),
        },
      });
  }

  // Single batched upsert for all features.
  if (featureRows.length > 0) {
    await db
      .insert(playerGameFeatures)
      .values(featureRows)
      .onConflictDoUpdate({
        target: [
          playerGameFeatures.playerId,
          playerGameFeatures.gameId,
          playerGameFeatures.statType,
        ],
        set: {
          seasonAverage: sql`excluded.season_average`,
          recentForm: sql`excluded.recent_form`,
          vsOpponentAvg: sql`excluded.vs_opponent_avg`,
          vsOpponentGames: sql`excluded.vs_opponent_games`,
        },
      });
  }

  return {
    gameId,
    playersProcessed: resolved.length,
    predictionsWritten: predRows.length,
    unresolved,
  };
}
