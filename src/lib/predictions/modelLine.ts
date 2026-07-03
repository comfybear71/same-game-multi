import type { StatType } from "@/db/schema";

// Sensible default prop rungs when no bookmaker line exists. Matches typical
// AFL SGM markets — never suggest "0+" (that came from floor(pred)-0.5 on tiny
// projections).

const DISPOSAL_RUNGS = [9.5, 14.5, 19.5, 24.5, 29.5, 34.5, 39.5];
const COUNT_RUNGS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5];

/** Highest standard rung the projection still clears; null if none bettable. */
export function modelPropLine(statType: StatType, prediction: number): number | null {
  const rungs = statType === "disposals" ? DISPOSAL_RUNGS : COUNT_RUNGS;
  const clearable = rungs.filter((r) => prediction > r);
  if (clearable.length === 0) return null;
  return clearable[clearable.length - 1]!;
}

/** Minimum whole-number target (e.g. 10+ disposals, 1+ goals). */
export function minLineTarget(statType: StatType): number {
  return statType === "disposals" ? 10 : 1;
}
