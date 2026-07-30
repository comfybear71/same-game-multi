import type { StatType } from "@/db/schema";

/** Normalised lineup codes: FB, HB, C, HF, FF, FOL (+ INT/EMG treated as weak). */
export function normaliseLineupPosition(
  position: string | null | undefined,
): string | null {
  if (!position?.trim()) return null;
  const p = position.trim().toUpperCase();
  if (p === "FOLLOWER" || p === "FOL") return "FOL";
  if (p.startsWith("INT") || p === "INTERCHANGE") return "INT";
  if (p.startsWith("EMG") || p === "EMERGENCY") return "EMG";
  if (["FB", "HB", "C", "HF", "FF"].includes(p)) return p;
  return p.slice(0, 3);
}

/**
 * Soft-score tilt from field position × market.
 * Goals: forwards first; lockdown backs penalised when forwards exist in pool.
 */
export function roleMarketSoftPoints(
  position: string | null | undefined,
  statType: StatType | "any",
): number {
  if (statType === "any") return 0;
  const p = normaliseLineupPosition(position);
  if (!p) return -8;

  switch (statType) {
    case "goals":
      if (p === "FF") return 32;
      if (p === "HF") return 22;
      if (p === "C" || p === "FOL") return 6;
      if (p === "HB") return -38;
      if (p === "FB") return -48;
      if (p === "INT") return -12;
      return -10;
    case "marks":
      if (p === "FB" || p === "HB") return 14;
      if (p === "C") return 6;
      if (p === "FF") return 4;
      if (p === "HF") return 0;
      if (p === "FOL") return -4;
      return 0;
    case "disposals":
      if (p === "C" || p === "FOL") return 12;
      if (p === "HB") return 8;
      if (p === "FB") return 5;
      if (p === "FF") return -6;
      return 0;
    case "tackles":
      if (p === "FB" || p === "HB") return 14;
      if (p === "C") return 6;
      if (p === "FF") return -8;
      return 0;
    default:
      return 0;
  }
}
