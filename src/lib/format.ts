// Display formatting for AFL stat counts.
//
// You can't get half a disposal / mark / tackle / goal, so the UI shows whole
// numbers only. Two rules, both pure (safe to import from client components):
//
//  - Projections and averages are FLOORED — rounded down to favour the downside
//    (a 12.8 projection shows as 12), matching the conservative "SGM AI" pick.
//  - Bookmaker over-lines (almost always X.5) are shown as the whole number you
//    must REACH to win — "over 9.5" → "10+". That's decimal-free, it's the
//    bookie's own format, and it keeps near-misses honest (got 24 on a 24.5
//    line reads as "24 vs 25+", a clear miss, not a rounded-down "push").
//
// The stored line stays the real .5 value — only the display changes — so bet
// settlement (actual > line) is unaffected.

/** Smallest whole number that WINS an over bet at this line (over 9.5 → 10). */
export function lineTarget(line: number): number {
  return Math.floor(line) + 1;
}

/** Bookmaker over-line as a decimal-free target, e.g. "10+". */
export function targetLabel(line: number): string {
  return `${lineTarget(line)}+`;
}

/** Floor a projected or averaged stat to a whole count (favour the downside). */
export function floorStat(n: number): number {
  return Math.floor(n);
}

/** Floor to a whole count, or "—" when null/undefined. */
export function floorStatLabel(n: number | null | undefined): string {
  return n == null ? "—" : String(Math.floor(n));
}

/** Whole-number margin of an actual result vs the line's target (got 11 on 9.5 → +1). */
export function marginVsTarget(actual: number, line: number): number {
  return actual - lineTarget(line);
}

/** Signed whole-number string, e.g. 2 → "+2", -1 → "-1", 0 → "0". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
