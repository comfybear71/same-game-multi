/** Shared Strategy lab → Bankroll sim filter state. */
export type LabControlFilters = {
  runId: number | null;
  focuses: string[];
  minLegs: number;
  maxLegs: number;
  /** 0 = all clubs, 1 = that club's games, 2 = H2H. */
  teams: string[];
  /** Flat $ stake per ticket (1–100). */
  stake: number;
};

export const DEFAULT_LAB_CONTROLS: Omit<LabControlFilters, "runId"> = {
  focuses: ["goals", "tackles", "marks", "disposals", "any"],
  minLegs: 3,
  maxLegs: 15,
  teams: [],
  stake: 5,
};

export function strategyKeyAllowed(
  key: string,
  focuses: string[],
  minLegs: number,
  maxLegs: number,
): boolean {
  const m = key.match(/^([a-z]+)_(\d+)$/i);
  if (!m) return false;
  const focus = m[1]!.toLowerCase();
  const legs = Number(m[2]);
  if (!focuses.includes(focus)) return false;
  if (!Number.isFinite(legs) || legs < minLegs || legs > maxLegs) return false;
  return true;
}
