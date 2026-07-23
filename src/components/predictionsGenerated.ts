import type { Top10BoardResponse } from "@/lib/predictions/top10Board";

/** Dispatched after predictions are written — may include fresh Top 10 payload. */
export const PREDICTIONS_GENERATED = "sgm:predictions-generated";

export type PredictionsGeneratedDetail = {
  gameId: number;
  top10?: Top10BoardResponse;
};

export function dispatchPredictionsGenerated(detail: PredictionsGeneratedDetail) {
  window.dispatchEvent(new CustomEvent(PREDICTIONS_GENERATED, { detail }));
}
