import type { StatType } from "@/db/schema";

// Default prop rungs when no bookmaker line exists. Tuned toward typical
// Sportsbet AFL SGM ladders — never suggest "0+" (that came from floor(pred)-0.5
// on tiny projections).
//
// Disposals: Sportsbet commonly posts 15 / 17 / 20 / 25 / 30 / 35+.
// Tackles: many players have no 1+ market — start at 2+.
// Marks / goals: 1+ (0.5) remains valid (anytime goalscorer, low mark lines).

const DISPOSAL_RUNGS = [9.5, 14.5, 16.5, 19.5, 24.5, 29.5, 34.5, 39.5];
const TACKLE_RUNGS = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
const COUNT_RUNGS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5];

/** Standard Sportsbet-style half-lines for a market. */
export function rungsFor(statType: StatType): number[] {
  if (statType === "disposals") return DISPOSAL_RUNGS;
  if (statType === "tackles") return TACKLE_RUNGS;
  return COUNT_RUNGS;
}

/** Highest standard rung the projection still clears; null if none bettable. */
export function modelPropLine(statType: StatType, prediction: number): number | null {
  const rungs = rungsFor(statType);
  const clearable = rungs.filter((r) => prediction > r);
  if (clearable.length === 0) return null;
  return clearable[clearable.length - 1]!;
}

/** Minimum whole-number target (e.g. 10+ disposals, 2+ tackles, 1+ goals). */
export function minLineTarget(statType: StatType): number {
  if (statType === "disposals") return 10;
  if (statType === "tackles") return 2;
  return 1;
}
