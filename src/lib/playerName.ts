/** Lowercase, strip punctuation — for matching names across sources. */
export function normalisePlayerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}
