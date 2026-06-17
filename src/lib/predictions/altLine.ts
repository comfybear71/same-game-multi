// Pure, no DB imports — safe to import from client components.
//
// When the punter nudges a leg's target off the bookmaker's posted line (say
// "6+ tackles" down to "4+"), we no longer have a real quoted price for it: AFL
// prop markets give a single line per player, not a full alternate-line ladder.
// Rather than leave the odds frozen (which would make a much easier leg look
// just as long), we re-estimate them from a simple Poisson model of the stat,
// anchored so the estimate exactly reproduces the real bookie odds at the
// original target and only extrapolates for the steps either side of it. It's
// still an estimate — the UI already tells the punter to confirm the real price
// in the bookie app — but it moves in the right direction and magnitude.

import { lineTarget } from "@/lib/format";

/** P(X = k) for a Poisson(lambda), computed iteratively to avoid overflow. */
function poissonSurvival(target: number, lambda: number): number {
  // P(X >= target) = 1 - P(X <= target - 1).
  if (target <= 0) return 1;
  if (lambda <= 0) return 0;
  let term = Math.exp(-lambda); // P(X = 0)
  let cdf = term; // P(X <= 0)
  for (let k = 1; k <= target - 1; k++) {
    term *= lambda / k;
    cdf += term;
  }
  return Math.min(1, Math.max(0, 1 - cdf));
}

/** Find lambda such that P(X >= target) ≈ p, by bisection (survival is monotonic in lambda). */
function solveLambda(target: number, p: number): number {
  let lo = 1e-4;
  let hi = 500;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (poissonSurvival(target, mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Estimate the over-odds for an alternative whole-number `target`, anchored to
 * the real bookmaker line/odds. Returns the original odds unchanged when the
 * target is unmoved, and null when we never had a price to anchor to.
 */
export function estimateOddsAtTarget(
  line: number,
  odds: number | null,
  newTarget: number,
): number | null {
  if (odds == null || odds <= 1) return odds;
  const baseTarget = lineTarget(line); // whole number needed to win at the posted line
  if (newTarget === baseTarget) return odds;

  const p0 = Math.min(0.9999, Math.max(1e-4, 1 / odds)); // implied prob at the posted line
  const lambda = solveLambda(baseTarget, p0);
  const pT = Math.min(0.9999, Math.max(1e-4, poissonSurvival(newTarget, lambda)));
  return Math.round((1 / pT) * 100) / 100;
}
