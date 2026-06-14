import type { ModelKey, StatType } from "@/db/schema";

export type { ModelKey, StatType };

/** Everything a model needs to predict one player's one stat for one game. */
export interface PredictionInput {
  statType: StatType;
  /** Season average for this stat (per game). */
  seasonAverage: number;
  /** Most-recent-first list of this stat across recent games (e.g. last 5). */
  recentForm: number[];
  /**
   * Opponent strength factor centred on 1.0. >1 means this opponent tends to
   * concede MORE of this stat (good for the player); <1 means they suppress it.
   */
  opponentFactor?: number;
  /**
   * Venue factor centred on 1.0. Captures ground size / player's record at the
   * venue. >1 lifts the prediction, <1 lowers it.
   */
  venueFactor?: number;
}

export interface ModelOutput {
  model: ModelKey;
  statType: StatType;
  predictedValue: number;
}

/** Tunable parameters for the form-weighted and smart models. */
export interface ModelParams {
  /** How many recent games to consider for "form". */
  formWindow: number;
  /** Blend between recent form and season average (0..1, higher = more form). */
  formWeight: number;
  /** Clamp opponent/venue factors to this band to avoid silly extremes. */
  factorClamp: [number, number];
}

export const DEFAULT_PARAMS: ModelParams = {
  formWindow: 5,
  formWeight: 0.6,
  factorClamp: [0.8, 1.2],
};
