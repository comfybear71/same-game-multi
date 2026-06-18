import type { StatType } from "@/db/schema";

// Per-player calibration: how a player's actual results compare to our
// pre-adjustment baseline prediction (Model B = form + season average). A
// player who consistently beats the baseline is one we systematically
// under-rate, so Model C nudges his number up; one who falls short gets nudged
// down. Measured against Model B (not the headline Model C) so the correction
// can't feed back on itself.

// Player aggregates need a few games before we trust the bias; until then the
// factor is pulled toward 1.0 (no adjustment).
const SHRINK_K = 6;

export interface Calibration {
  /** Multiplicative factor centred on 1.0 (>1 = we under-rate this player). */
  factor: number;
  predAvg: number;
  actualAvg: number;
  games: number;
}

export type CalibrationMap = Map<string, Calibration>; // key: `${playerId}:${stat}`

export function calKey(playerId: number, stat: StatType): string {
  return `${playerId}:${stat}`;
}

function shrink(ratio: number, n: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0 || n <= 0) return 1;
  const weight = n / (n + SHRINK_K);
  return 1 + (ratio - 1) * weight;
}

/** Bias from paired (baseline prediction, actual) samples for one player+stat. */
export function calibration(predicted: number[], actual: number[]): Calibration | null {
  const n = Math.min(predicted.length, actual.length);
  if (n === 0) return null;
  let predSum = 0;
  let actualSum = 0;
  for (let i = 0; i < n; i++) {
    predSum += predicted[i];
    actualSum += actual[i];
  }
  const predAvg = predSum / n;
  const actualAvg = actualSum / n;
  const ratio = predAvg > 0 ? actualAvg / predAvg : 1;
  return { factor: shrink(ratio, n), predAvg, actualAvg, games: n };
}
