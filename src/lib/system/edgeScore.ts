/**
 * Odds-aware edge + line cushion + last-5 trend soft-score modifiers.
 * Pure / unit-testable — no DB.
 *
 * Weight order (defaults): |edge| > cushion > last-5 ≈ last-game leaders.
 */

export type EdgeScoreWeights = {
  /** Soft points per absolute edge unit (0.10 edge → 0.10 * weight). */
  edgeWeight: number;
  /** Soft points when line sits a full season-average below the avg. */
  cushionWeight: number;
  /** Cap (±) for last-5 trend tilt. */
  trendWeight: number;
  /** Soft points for last-game #1 in-category (rank 2/3 scale down). */
  leadersWeight: number;
};

export const DEFAULT_EDGE_WEIGHTS: EdgeScoreWeights = {
  edgeWeight: 50,
  cushionWeight: 12,
  trendWeight: 6,
  leadersWeight: 6,
};

/** 3.10 decimal → ~32.26% implied. */
export function impliedProbability(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return NaN;
  return 1 / decimalOdds;
}

/** model% − implied%. Null when no usable price. */
export function modelEdge(
  modelProb: number,
  decimalOdds: number | null | undefined,
): number | null {
  if (decimalOdds == null || !Number.isFinite(decimalOdds) || decimalOdds <= 1) {
    return null;
  }
  if (!Number.isFinite(modelProb)) return null;
  const implied = impliedProbability(decimalOdds);
  if (!Number.isFinite(implied)) return null;
  return modelProb - implied;
}

export function edgeSoftPoints(
  edge: number | null,
  weight = DEFAULT_EDGE_WEIGHTS.edgeWeight,
): number {
  if (edge == null || !Number.isFinite(edge)) return 0;
  return edge * weight;
}

/**
 * Lines at/below season average score higher than lines demanding above-avg output.
 * cushion = ((seasonAvg − line) / seasonAvg) × weight.
 */
export function cushionSoftPoints(
  line: number,
  seasonAvg: number | null | undefined,
  weight = DEFAULT_EDGE_WEIGHTS.cushionWeight,
): number {
  if (seasonAvg == null || !Number.isFinite(seasonAvg) || seasonAvg <= 0) {
    return 0;
  }
  if (!Number.isFinite(line)) return 0;
  return ((seasonAvg - line) / seasonAvg) * weight;
}

/**
 * Last-5 trend: recent half vs older half of most-recent-first form.
 * Positive when hot; capped at ±weight.
 */
export function last5TrendSoftPoints(
  recentForm: number[] | null | undefined,
  weight = DEFAULT_EDGE_WEIGHTS.trendWeight,
): number {
  const form = (recentForm ?? []).filter((v) => Number.isFinite(v)).slice(0, 5);
  if (form.length < 3) return 0;
  const split = Math.ceil(form.length / 2);
  const recent = mean(form.slice(0, split));
  const older = mean(form.slice(split));
  if (older <= 0) return 0;
  const tilt = (recent - older) / older;
  return Math.max(-weight, Math.min(weight, tilt * weight * 2));
}

/**
 * Rank 1..3 in that category last game → leadersWeight × (4−rank)/3.
 * Category-scoped by caller (goals leader only on goals legs).
 */
export function lastGameLeaderSoftPoints(
  rank: number | null | undefined,
  weight = DEFAULT_EDGE_WEIGHTS.leadersWeight,
): number {
  if (rank == null || rank < 1 || rank > 3) return 0;
  return weight * ((4 - rank) / 3);
}

export type EdgeModifiers = {
  edge: number | null;
  impliedProb: number | null;
  bookOdds: number | null;
  edgePts: number;
  cushionPts: number;
  trendPts: number;
  leaderRank: number | null;
  leaderLastValue: number | null;
  leaderPts: number;
  totalPts: number;
};

export function computeEdgeModifiers(opts: {
  modelProb: number;
  bookOdds?: number | null;
  line: number;
  seasonAvg?: number | null;
  recentForm?: number[] | null;
  leaderRank?: number | null;
  leaderLastValue?: number | null;
  weights?: Partial<EdgeScoreWeights>;
}): EdgeModifiers {
  const w = { ...DEFAULT_EDGE_WEIGHTS, ...opts.weights };
  const bookOdds = opts.bookOdds ?? null;
  const edge = modelEdge(opts.modelProb, bookOdds);
  const implied =
    bookOdds != null && bookOdds > 1 ? impliedProbability(bookOdds) : null;
  const edgePts = edgeSoftPoints(edge, w.edgeWeight);
  const cushionPts = cushionSoftPoints(opts.line, opts.seasonAvg, w.cushionWeight);
  const trendPts = last5TrendSoftPoints(opts.recentForm, w.trendWeight);
  const leaderRank = opts.leaderRank ?? null;
  const leaderPts = lastGameLeaderSoftPoints(leaderRank, w.leadersWeight);
  return {
    edge,
    impliedProb: implied,
    bookOdds,
    edgePts,
    cushionPts,
    trendPts,
    leaderRank,
    leaderLastValue: opts.leaderLastValue ?? null,
    leaderPts,
    totalPts: edgePts + cushionPts + trendPts + leaderPts,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
