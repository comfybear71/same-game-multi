/** Squiggle/DB use 0 before kickoff — not a real in-play score. */
export function hasRealScores(
  home: number | null | undefined,
  away: number | null | undefined,
  complete = 0,
): boolean {
  const h = home ?? 0;
  const a = away ?? 0;
  if (complete >= 100) return true;
  if (complete > 0) return h > 0 || a > 0;
  return h > 0 || a > 0;
}

export function formatScoreLine(
  home: number | null | undefined,
  away: number | null | undefined,
  complete = 0,
): string {
  if (!hasRealScores(home, away, complete)) return "–";
  return `${home ?? 0} – ${away ?? 0}`;
}
