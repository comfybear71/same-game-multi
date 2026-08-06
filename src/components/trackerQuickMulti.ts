import type { StatType } from "@/db/schema";
import type { BetTrackerLeg } from "@/lib/betTypes";
import { playerRecordKey } from "@/lib/betTypes";

/** Fired when LiveBetTracker builds a random N-leg Sportsbet multi. */
export const QUICK_MULTI_FILLED = "sgm:quick-multi-filled";

export type QuickMultiLeg = {
  playerName: string;
  statType: StatType;
  line: number;
  odds: number | null;
  prediction: number | null;
  team: string | null;
  jumper: number | null;
};

export type QuickMultiFilledDetail = {
  gameId: number;
  legCount: number;
  legs: QuickMultiLeg[];
  betId?: number;
};

export function dispatchQuickMultiFilled(detail: QuickMultiFilledDetail) {
  window.dispatchEvent(new CustomEvent(QUICK_MULTI_FILLED, { detail }));
}

/** Fisher–Yates partial shuffle — pick n unique items. */
export function sampleLegs<T>(pool: T[], n: number): T[] {
  if (n <= 0 || pool.length === 0) return [];
  const copy = [...pool];
  const take = Math.min(n, copy.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, take);
}

/** One leg per player×stat — avoids duplicate rows on the same multi. */
export function uniqueTrackerLegs(legs: BetTrackerLeg[]): BetTrackerLeg[] {
  const seen = new Set<string>();
  const out: BetTrackerLeg[] = [];
  for (const leg of legs) {
    const name = leg.playerName ?? "";
    const key = playerRecordKey(name, leg.statType);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(leg);
  }
  return out;
}
