/**
 * Last-game leaders: top 3 per stat from both clubs' previous completed games.
 * Pure ranking is unit-tested; DB loader is in lastGameLeadersDb.ts.
 */

import type { StatType } from "@/db/schema";

export const LEADER_STATS: StatType[] = [
  "disposals",
  "marks",
  "tackles",
  "goals",
];

export type PrevGameStatRow = {
  playerId: number;
  team: string;
  disposals: number | null;
  marks: number | null;
  tackles: number | null;
  goals: number | null;
};

export type LastGameLeader = {
  playerId: number;
  statType: StatType;
  /** 1 = highest in that category (pooled across both clubs' prev games). */
  rank: number;
  lastValue: number;
};

/**
 * From both clubs' previous-game stat rows, pick top 3 per category.
 * Empty input → empty leaders (graceful no-previous-game fallback).
 */
export function rankLastGameLeaders(
  rows: PrevGameStatRow[],
): LastGameLeader[] {
  if (rows.length === 0) return [];

  const out: LastGameLeader[] = [];
  for (const stat of LEADER_STATS) {
    const scored = rows
      .map((r) => ({
        playerId: r.playerId,
        value: r[stat],
      }))
      .filter(
        (r): r is { playerId: number; value: number } =>
          r.value != null && Number.isFinite(r.value),
      )
      .sort((a, b) => b.value - a.value || a.playerId - b.playerId);

    const seen = new Set<number>();
    let rank = 0;
    for (const s of scored) {
      if (seen.has(s.playerId)) continue;
      seen.add(s.playerId);
      rank++;
      if (rank > 3) break;
      out.push({
        playerId: s.playerId,
        statType: stat,
        rank,
        lastValue: s.value,
      });
    }
  }
  return out;
}

/** Lookup: `${playerId}:${statType}` → leader info. */
export function leadersByKey(
  leaders: LastGameLeader[],
): Map<string, LastGameLeader> {
  const map = new Map<string, LastGameLeader>();
  for (const l of leaders) {
    map.set(`${l.playerId}:${l.statType}`, l);
  }
  return map;
}
