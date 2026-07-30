import { normalisePlayerName } from "@/lib/playerName";

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

/** Stored on `bets.notes` when logging a what-if slip (not placed on the book). */
export const PAPER_BET_NOTE = "Paper — not placed on book";

export function isPaperBet(notes: string | null | undefined): boolean {
  return !!notes && /paper/i.test(notes);
}

/** Lookup key for a player's record on a given stat (server + client). */
export function playerRecordKey(name: string, stat: string): string {
  return `${normalisePlayerName(name)}:${stat}`;
}

/** One leg in the live "your bets in this game" panel. */
export interface BetTrackerLeg {
  legId: number;
  betId: number;
  /** What-if slip — full edit. Sportsbet slips: +/- live only (no remove/market edit). */
  paper: boolean;
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
