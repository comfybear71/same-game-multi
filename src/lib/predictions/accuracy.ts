import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  bookmakerLines,
  games,
  modelAccuracy,
  playerGameStats,
  predictions,
  type ModelKey,
  type StatType,
} from "@/db/schema";

// Score the models for a completed round and persist to model_accuracy.
//
//   mae       — mean absolute error of the prediction vs the actual.
//   accuracy  — share of predictions on the correct side of the bookmaker line
//               (the "line call": predicted over/under matched the result).
//
// Both are tracked so you can see raw forecasting accuracy (MAE) and bet-
// relevant accuracy (line call) per model and stat type.

interface Bucket {
  absErrorSum: number;
  count: number;
  lineHits: number;
  lineCount: number;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface AccuracyResult {
  season: number;
  round: number;
  rowsWritten: number;
  samples: number;
}

export async function computeRoundAccuracy(
  season: number,
  round: number,
): Promise<AccuracyResult> {
  const roundGames = await db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.round, round), eq(games.status, "complete")));

  // buckets[model][stat]
  const buckets = new Map<string, Bucket>();
  const bk = (m: ModelKey, s: StatType) => `${m}:${s}`;
  const bucket = (m: ModelKey, s: StatType): Bucket => {
    const key = bk(m, s);
    let b = buckets.get(key);
    if (!b) {
      b = { absErrorSum: 0, count: 0, lineHits: 0, lineCount: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  let samples = 0;

  for (const game of roundGames) {
    const preds = await db
      .select()
      .from(predictions)
      .where(eq(predictions.gameId, game.id));
    const actuals = await db
      .select()
      .from(playerGameStats)
      .where(and(eq(playerGameStats.gameId, game.id), eq(playerGameStats.settled, true)));
    const lines = await db
      .select()
      .from(bookmakerLines)
      .where(eq(bookmakerLines.gameId, game.id));

    const actualByPlayer = new Map<number, (typeof actuals)[number]>();
    for (const a of actuals) actualByPlayer.set(a.playerId, a);

    // Median bookmaker line per (playerId, stat).
    const lineByKey = new Map<string, number>();
    const grouped = new Map<string, number[]>();
    for (const l of lines) {
      if (l.playerId == null) continue;
      const k = `${l.playerId}:${l.statType}`;
      const arr = grouped.get(k) ?? [];
      arr.push(l.line);
      grouped.set(k, arr);
    }
    for (const [k, arr] of grouped) lineByKey.set(k, median(arr));

    for (const p of preds) {
      const actual = actualByPlayer.get(p.playerId);
      if (!actual) continue;
      const actualValue = (actual as unknown as Record<string, number | null>)[p.statType];
      if (actualValue == null) continue;

      const b = bucket(p.model, p.statType);
      b.absErrorSum += Math.abs(p.predictedValue - actualValue);
      b.count += 1;
      samples += 1;

      const line = lineByKey.get(`${p.playerId}:${p.statType}`);
      if (line != null && !Number.isNaN(line)) {
        const predOver = p.predictedValue > line;
        const actualOver = actualValue > line;
        if (predOver === actualOver) b.lineHits += 1;
        b.lineCount += 1;
      }
    }
  }

  let rowsWritten = 0;
  for (const [key, b] of buckets) {
    if (b.count === 0) continue;
    const [model, statType] = key.split(":") as [ModelKey, StatType];
    await db
      .insert(modelAccuracy)
      .values({
        season,
        round,
        model,
        statType,
        mae: b.absErrorSum / b.count,
        accuracy: b.lineCount > 0 ? b.lineHits / b.lineCount : null,
        roi: null,
        sampleSize: b.count,
      })
      .onConflictDoUpdate({
        target: [
          modelAccuracy.season,
          modelAccuracy.round,
          modelAccuracy.model,
          modelAccuracy.statType,
        ],
        set: {
          mae: b.absErrorSum / b.count,
          accuracy: b.lineCount > 0 ? b.lineHits / b.lineCount : null,
          sampleSize: b.count,
        },
      });
    rowsWritten++;
  }

  return { season, round, rowsWritten, samples };
}
