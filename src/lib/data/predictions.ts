import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  bookmakerLines,
  players,
  playerGameStats,
  predictions,
  type ModelKey,
  type StatType,
} from "@/db/schema";
import { STAT_TYPES } from "@/lib/predictions/features";

// Assemble per-player, per-stat prediction rows for a game: Models A/B/C, the
// median bookmaker line, the edge (best model vs line) and the actual once
// settled. Drives the game detail predictions table + charts.

export interface StatCell {
  line: number | null;
  models: Record<ModelKey, number | null>;
  actual: number | null;
}

export interface PlayerPredictionRow {
  playerId: number;
  playerName: string;
  team: string;
  stats: Record<StatType, StatCell>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function emptyCell(): StatCell {
  return { line: null, models: { A: null, B: null, C: null }, actual: null };
}

export async function getGamePredictions(gameId: number): Promise<PlayerPredictionRow[]> {
  const preds = await db
    .select({
      playerId: predictions.playerId,
      name: players.name,
      team: players.team,
      statType: predictions.statType,
      model: predictions.model,
      value: predictions.predictedValue,
    })
    .from(predictions)
    .innerJoin(players, eq(predictions.playerId, players.id))
    .where(eq(predictions.gameId, gameId));

  if (preds.length === 0) return [];

  const lines = await db
    .select()
    .from(bookmakerLines)
    .where(eq(bookmakerLines.gameId, gameId));
  const actuals = await db
    .select()
    .from(playerGameStats)
    .where(and(eq(playerGameStats.gameId, gameId), eq(playerGameStats.settled, true)));

  // Median line per (playerId, stat).
  const lineGroups = new Map<string, number[]>();
  for (const l of lines) {
    if (l.playerId == null) continue;
    const k = `${l.playerId}:${l.statType}`;
    const arr = lineGroups.get(k) ?? [];
    arr.push(l.line);
    lineGroups.set(k, arr);
  }

  const actualByPlayer = new Map<number, (typeof actuals)[number]>();
  for (const a of actuals) actualByPlayer.set(a.playerId, a);

  const rows = new Map<number, PlayerPredictionRow>();
  for (const p of preds) {
    let row = rows.get(p.playerId);
    if (!row) {
      row = {
        playerId: p.playerId,
        playerName: p.name,
        team: p.team,
        stats: Object.fromEntries(STAT_TYPES.map((s) => [s, emptyCell()])) as Record<
          StatType,
          StatCell
        >,
      };
      rows.set(p.playerId, row);
    }
    row.stats[p.statType].models[p.model] = p.value;
  }

  // Attach lines + actuals.
  for (const row of rows.values()) {
    const actual = actualByPlayer.get(row.playerId);
    for (const stat of STAT_TYPES) {
      row.stats[stat].line = median(lineGroups.get(`${row.playerId}:${stat}`) ?? []);
      if (actual) {
        row.stats[stat].actual = (actual as unknown as Record<string, number | null>)[stat];
      }
    }
  }

  return [...rows.values()].sort((a, b) => a.playerName.localeCompare(b.playerName));
}
