// Probability that a player clears a prop line, modelled from our projected
// rate rather than a raw recent hit-count.
//
// The old confidence blended recent hit-rate (over the line) with an edge
// margin. That trusted tiny samples far too much: a player with one game read
// as a 100% hit rate and so the steadiest pick on the board, and a streaky
// low-average scorer looked safer than his average could justify. Here we
// instead model the count distribution and read the probability of clearing
// the line straight off it, then shrink it toward 50/50 by how many games of
// form we actually have — so a thin sample can't masquerade as a certainty.
//
// Counts are modelled as Poisson at low rates (goals, marks, tackles) and via
// a normal approximation at higher rates (disposals), which are over-dispersed
// enough that a Poisson under-states their spread.

/** Pseudo-games of a 50/50 prior mixed in — controls small-sample shrinkage. */
const PRIOR_GAMES = 4;

/** Below this projected rate we use Poisson; above it, a normal approximation. */
const POISSON_MAX_RATE = 8;

/** Poisson P(X >= k) for a small integer target k and rate lambda. */
function poissonSf(lambda: number, k: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  // 1 - P(X <= k-1), summing the pmf up from P(X = 0).
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i <= k - 1; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

/** Error function (Abramowitz & Stegun 7.1.26) — for the normal CDF. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF, P(Z <= z). */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Sample standard deviation, or null below two observations. */
function sampleStd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export interface ClearInputs {
  /** Our projected count for the stat (the Poisson/normal rate). */
  prediction: number;
  /** The bookmaker line, e.g. 1.5 — the player must reach floor(line)+1 to win. */
  line: number;
  /** Recent per-game counts for this stat, used for spread + sample size. */
  form: number[];
}

/**
 * Probability the player clears the line (an over bet lands), in [0, 1].
 *
 * Reads P(count >= target) off the modelled distribution around our projection,
 * then shrinks toward 0.5 by sample size: with n games of form the model is
 * trusted n / (n + PRIOR_GAMES) of the way, the rest pulled to a coin flip. So
 * one game barely moves off 50/50 no matter how good it looked, while a full
 * season of form is trusted almost entirely.
 */
export function clearProbability({ prediction, line, form }: ClearInputs): number {
  const target = Math.floor(line) + 1; // smallest count that wins an over bet
  const lambda = Math.max(prediction, 0);

  const modelled =
    lambda < POISSON_MAX_RATE
      ? poissonSf(lambda, target)
      : // Over-dispersed high counts: normal approx with a continuity
        // correction, spread from recent form (fallback to Poisson's sqrt).
        1 - normalCdf((target - 0.5 - lambda) / Math.max(sampleStd(form) ?? Math.sqrt(lambda), 1));

  const trust = form.length / (form.length + PRIOR_GAMES);
  return 0.5 + (modelled - 0.5) * trust;
}
