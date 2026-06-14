// Club colours for jumper badges / accents. Keyed by canonical team name.
// Approximate primary + contrasting text colour — enough to tell clubs apart.

export interface TeamColor {
  bg: string;
  fg: string;
}

export const TEAM_COLORS: Record<string, TeamColor> = {
  Adelaide: { bg: "#002B5C", fg: "#FFD200" },
  "Brisbane Lions": { bg: "#7A0026", fg: "#FFC72C" },
  Carlton: { bg: "#001E3C", fg: "#FFFFFF" },
  Collingwood: { bg: "#000000", fg: "#FFFFFF" },
  Essendon: { bg: "#111111", fg: "#CC2031" },
  Fremantle: { bg: "#2A0D54", fg: "#FFFFFF" },
  Geelong: { bg: "#002B5C", fg: "#FFFFFF" },
  "Gold Coast": { bg: "#D6232E", fg: "#FFD200" },
  "Greater Western Sydney": { bg: "#F47920", fg: "#1A1A1A" },
  Hawthorn: { bg: "#4D2004", fg: "#FBBF24" },
  Melbourne: { bg: "#0F1131", fg: "#CC2031" },
  "North Melbourne": { bg: "#1746A2", fg: "#FFFFFF" },
  "Port Adelaide": { bg: "#008AAB", fg: "#FFFFFF" },
  Richmond: { bg: "#111111", fg: "#FFD200" },
  "St Kilda": { bg: "#ED1B2E", fg: "#FFFFFF" },
  Sydney: { bg: "#ED1C24", fg: "#FFFFFF" },
  "West Coast": { bg: "#003087", fg: "#F2A900" },
  "Western Bulldogs": { bg: "#014896", fg: "#FFFFFF" },
};

export function teamColors(team: string): TeamColor {
  return TEAM_COLORS[team] ?? { bg: "#334155", fg: "#FFFFFF" };
}
