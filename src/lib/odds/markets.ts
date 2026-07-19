/**
 * The Odds API v4 AFL player-prop markets.
 * Source: https://the-odds-api.com/sports-odds-data/betting-markets.html
 * Sport key: aussierules_afl
 */

export const ODDS_API_SPORT = "aussierules_afl" as const;

/** Markets we harvest for model↔bookie calibration (O/U or over-only). */
export const HARVEST_MARKETS = [
  "player_disposals",
  "player_disposals_over",
  "player_goals_scored_over",
  "player_marks_over",
  "player_tackles_over",
  "player_afl_fantasy_points",
  "player_afl_fantasy_points_over",
] as const;

export type HarvestMarket = (typeof HARVEST_MARKETS)[number];

/** Documented AFL player props we intentionally skip (log as unmapped). */
export const AFL_PLAYER_PROP_MARKETS_SKIP = [
  "player_goal_scorer_first",
  "player_goal_scorer_last",
  "player_goal_scorer_anytime",
  "player_marks_most",
  "player_tackles_most",
  "player_afl_fantasy_points_most",
  "player_clearances_over",
  "player_kicks_over",
  "player_handballs_over",
] as const;

export type StatFamily =
  | "disposals"
  | "marks"
  | "tackles"
  | "goals"
  | "fantasy"
  | "kicks"
  | "handballs";

const MARKET_TO_FAMILY: Record<string, StatFamily> = {
  player_disposals: "disposals",
  player_disposals_over: "disposals",
  player_goals_scored_over: "goals",
  player_marks_over: "marks",
  player_tackles_over: "tackles",
  player_afl_fantasy_points: "fantasy",
  player_afl_fantasy_points_over: "fantasy",
  player_kicks_over: "kicks",
  player_handballs_over: "handballs",
};

export function mapMarketToStatFamily(marketKey: string): StatFamily | null {
  return MARKET_TO_FAMILY[marketKey] ?? null;
}

export function harvestMarketsCsv(): string {
  return HARVEST_MARKETS.join(",");
}

/** Markets present in a list that we don't harvest / can't map. */
export function unmappedMarkets(available: string[]): string[] {
  const harvest = new Set<string>(HARVEST_MARKETS);
  return available.filter((m) => m.startsWith("player_") && !harvest.has(m));
}
