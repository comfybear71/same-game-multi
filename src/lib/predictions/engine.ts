import {
  DEFAULT_PARAMS,
  type ModelOutput,
  type ModelParams,
  type PredictionInput,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Prediction engine — three models, side by side.
//
//   Model A (Simple):        season average.
//   Model B (Form-weighted): recent form weighted heavier than the season.
//   Model C (Smart):         form-weighted, then adjusted for opponent strength
//                            and venue.
//
// These are first-pass formulas with explicit, tunable parameters. The plan is
// described in HANDOFF.md — confirm/tune before this feeds automated cron
// generation and the accuracy scorecard.
// ─────────────────────────────────────────────────────────────────────────────

function clamp(x: number, [lo, hi]: [number, number]): number {
  return Math.max(lo, Math.min(hi, x));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Recency-weighted average of recent form (most-recent first, linear weights). */
function weightedFormAverage(recentForm: number[], window: number): number | null {
  const games = recentForm.slice(0, window).filter((v) => Number.isFinite(v));
  if (games.length === 0) return null;
  // Linear weights: most recent game gets the highest weight.
  let weightSum = 0;
  let acc = 0;
  games.forEach((value, i) => {
    const w = games.length - i; // e.g. [5,4,3,2,1]
    acc += value * w;
    weightSum += w;
  });
  return acc / weightSum;
}

/** Model A — season average. */
export function modelA(input: PredictionInput): number {
  return round1(input.seasonAverage);
}

/** Model B — blend of recency-weighted form and season average. */
export function modelB(
  input: PredictionInput,
  params: ModelParams = DEFAULT_PARAMS,
): number {
  const formAvg = weightedFormAverage(input.recentForm, params.formWindow);
  if (formAvg === null) return round1(input.seasonAverage);
  const blended =
    params.formWeight * formAvg + (1 - params.formWeight) * input.seasonAverage;
  return round1(blended);
}

/** Model C — Model B adjusted by clamped opponent, venue, and team matchup factors. */
export function modelC(
  input: PredictionInput,
  params: ModelParams = DEFAULT_PARAMS,
): number {
  const base = modelB(input, params);
  const opp = clamp(input.opponentFactor ?? 1, params.factorClamp);
  const venue = clamp(input.venueFactor ?? 1, params.factorClamp);
  const team = clamp(input.teamFactor ?? 1, params.teamFactorClamp);
  return round1(base * opp * venue * team);
}

/** Run all three models for one input. */
export function runAllModels(
  input: PredictionInput,
  params: ModelParams = DEFAULT_PARAMS,
): ModelOutput[] {
  return [
    { model: "A", statType: input.statType, predictedValue: modelA(input) },
    { model: "B", statType: input.statType, predictedValue: modelB(input, params) },
    { model: "C", statType: input.statType, predictedValue: modelC(input, params) },
  ];
}
