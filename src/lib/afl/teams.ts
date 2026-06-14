// Canonical AFL team names + alias resolution so data from Squiggle, The Odds
// API and AFL Tables reconcile to one identity. AFL only.

export const AFL_TEAMS = [
  "Adelaide",
  "Brisbane Lions",
  "Carlton",
  "Collingwood",
  "Essendon",
  "Fremantle",
  "Geelong",
  "Gold Coast",
  "Greater Western Sydney",
  "Hawthorn",
  "Melbourne",
  "North Melbourne",
  "Port Adelaide",
  "Richmond",
  "St Kilda",
  "Sydney",
  "West Coast",
  "Western Bulldogs",
] as const;

export type AflTeam = (typeof AFL_TEAMS)[number];

// Lower-cased alias -> canonical name. Covers the common variants each source
// emits. Extend as you spot new spellings.
const ALIASES: Record<string, AflTeam> = {
  "adelaide": "Adelaide",
  "adelaide crows": "Adelaide",
  "brisbane": "Brisbane Lions",
  "brisbane lions": "Brisbane Lions",
  "carlton": "Carlton",
  "carlton blues": "Carlton",
  "collingwood": "Collingwood",
  "collingwood magpies": "Collingwood",
  "essendon": "Essendon",
  "essendon bombers": "Essendon",
  "fremantle": "Fremantle",
  "fremantle dockers": "Fremantle",
  "geelong": "Geelong",
  "geelong cats": "Geelong",
  "gold coast": "Gold Coast",
  "gold coast suns": "Gold Coast",
  "greater western sydney": "Greater Western Sydney",
  "gws": "Greater Western Sydney",
  "gws giants": "Greater Western Sydney",
  "hawthorn": "Hawthorn",
  "hawthorn hawks": "Hawthorn",
  "melbourne": "Melbourne",
  "melbourne demons": "Melbourne",
  "north melbourne": "North Melbourne",
  "north melbourne kangaroos": "North Melbourne",
  "kangaroos": "North Melbourne",
  "port adelaide": "Port Adelaide",
  "port adelaide power": "Port Adelaide",
  "richmond": "Richmond",
  "richmond tigers": "Richmond",
  "st kilda": "St Kilda",
  "st kilda saints": "St Kilda",
  "sydney": "Sydney",
  "sydney swans": "Sydney",
  "west coast": "West Coast",
  "west coast eagles": "West Coast",
  "western bulldogs": "Western Bulldogs",
  "footscray": "Western Bulldogs",
  "bulldogs": "Western Bulldogs",
};

/** Resolve any source spelling to a canonical team name (or null if unknown). */
export function canonicalTeam(name: string | null | undefined): AflTeam | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return ALIASES[key] ?? null;
}
