/** Result of an individual leg once settled. */
export type LegResult = "pending" | "hit" | "miss" | "void";

/** Lifecycle of a bet slip (same-game multi). */
export type BetSlipStatus = "pending" | "won" | "lost" | "void";

/** Derive slip status from leg results — any void leg = stake returned. */
export function deriveSlipStatus(legs: { result: string }[]): BetSlipStatus {
  const active = legs.filter((l) => l.result !== "void");
  if (active.length === 0) return "void";
  if (active.some((l) => l.result === "pending")) return "pending";
  if (legs.some((l) => l.result === "void")) return "void";
  if (active.some((l) => l.result === "miss")) return "lost";
  return "won";
}

/** One leg in the live "your bets in this game" panel. */
export interface BetTrackerLeg {
  legId: number;
  betId: number;
  playerName: string | null;
  jumper: number | null;
  team: string | null;
  statType: string;
  line: number;
  odds: number | null;
  result: LegResult;
  actualValue: number | null;
  prediction: number | null;
}
