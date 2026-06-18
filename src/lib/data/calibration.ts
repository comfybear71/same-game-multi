import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { playerGameStats, predictions, type StatType } from "@/db/schema";
import {
  calibration,
  calKey,
  type CalibrationMap,
} from "@/lib/predictions/calibration";

// Build per-player calibration from stored Model B predictions vs settled
// actuals. Model B is the form/season baseline (no opponent/venue/team/player
// adjustments), so comparing it to actuals isolates a stable per-player bias
// that Model C can correct without chasing its own output.
export async function getPlayerCalibration(
  playerIds?: number[],
): Promise<CalibrationMap> {
  const scoped = playerIds && playerIds.length > 0;
  const preds = await db
    .select({
      playerId: predictions.playerId,
      gameId: predictions.gameId,
      statType: predictions.statType,
      value: predictions.predictedValue,
    })
    .from(predictions)
    .where(
      scoped
        ? and(eq(predictions.model, "B"), inArray(predictions.playerId, playerIds))
        : eq(predictions.model, "B"),
    );
  if (preds.length === 0) return new Map();

  const gameIds = [...new Set(preds.map((p) => p.gameId))];
  const actuals = await db
    .select()
    .from(playerGameStats)
    .where(
      and(eq(playerGameStats.settled, true), inArray(playerGameStats.gameId, gameIds)),
    );

  const actualByKey = new Map<string, Record<string, number | null>>();
  for (const a of actuals) {
    actualByKey.set(
      `${a.playerId}:${a.gameId}`,
      a as unknown as Record<string, number | null>,
    );
  }

  // Pair each baseline prediction with the player's actual for that game/stat.
  const pairs = new Map<string, { pred: number[]; act: number[] }>();
  for (const p of preds) {
    const a = actualByKey.get(`${p.playerId}:${p.gameId}`);
    if (!a) continue;
    const actual = a[p.statType];
    if (actual == null) continue;
    const key = calKey(p.playerId, p.statType as StatType);
    const entry = pairs.get(key) ?? { pred: [], act: [] };
    entry.pred.push(p.value);
    entry.act.push(actual);
    pairs.set(key, entry);
  }

  const out: CalibrationMap = new Map();
  for (const [key, { pred, act }] of pairs) {
    const c = calibration(pred, act);
    if (c) out.set(key, c);
  }
  return out;
}
