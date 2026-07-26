/**
 * Normalise AFL team-sheet position rows to short codes (Match Centre / JPEG labels).
 * FB HB C HF FF FOL — interchange and emergency players have no on-field line.
 */

const POSITION_MAP: [RegExp, string][] = [
  [/^full\s*backs?$/i, "FB"],
  [/^half\s*backs?$/i, "HB"],
  [/^centre?s?$/i, "C"],
  [/^center$/i, "C"],
  [/^half\s*forwards?$/i, "HF"],
  [/^full\s*forwards?$/i, "FF"],
  [/^followers?$/i, "FOL"],
  [/^fol$/i, "FOL"],
  [/^fb$/i, "FB"],
  [/^hb$/i, "HB"],
  [/^c$/i, "C"],
  [/^hf$/i, "HF"],
  [/^ff$/i, "FF"],
];

export const LINEUP_POSITION_CODES = ["FB", "HB", "C", "HF", "FF", "FOL"] as const;
export type LineupPositionCode = (typeof LINEUP_POSITION_CODES)[number];

export function normalizeLineupPosition(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^interchange/i.test(t) || /^emergenc/i.test(t)) return null;
  for (const [re, code] of POSITION_MAP) {
    if (re.test(t)) return code;
  }
  return t;
}

/** Human label for squad board display. */
export function lineupPositionLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code.toUpperCase()) {
    case "FB":
      return "Full Backs";
    case "HB":
      return "Half Backs";
    case "C":
      return "Centres";
    case "HF":
      return "Half Forwards";
    case "FF":
      return "Full Forwards";
    case "FOL":
      return "Followers";
    default:
      return code;
  }
}
