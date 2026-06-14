// Canonical venue names + alias resolution. AFL Tables, Squiggle and The Odds
// API spell venues differently; map them to one identity so per-venue history
// joins. Unknown venues resolve to null and the venue factor falls back to 1.0.

export type CanonicalVenue = string;

// Lower-cased alias -> canonical venue. Canonical is the AFL Tables spelling
// where practical (that's our history source). Extend as you spot new names.
const ALIASES: Record<string, CanonicalVenue> = {
  // MCG
  "m.c.g.": "M.C.G.",
  "mcg": "M.C.G.",
  "melbourne cricket ground": "M.C.G.",
  // Marvel / Docklands
  "marvel stadium": "Docklands",
  "docklands": "Docklands",
  "etihad stadium": "Docklands",
  "telstra dome": "Docklands",
  // SCG
  "s.c.g.": "S.C.G.",
  "scg": "S.C.G.",
  "sydney cricket ground": "S.C.G.",
  // Optus / Perth
  "optus stadium": "Perth Stadium",
  "perth stadium": "Perth Stadium",
  // Adelaide Oval
  "adelaide oval": "Adelaide Oval",
  // Gabba
  "gabba": "Gabba",
  "the gabba": "Gabba",
  "brisbane cricket ground": "Gabba",
  // Geelong
  "gmhba stadium": "Kardinia Park",
  "g.m.h.b.a. stadium": "Kardinia Park",
  "kardinia park": "Kardinia Park",
  "simonds stadium": "Kardinia Park",
  // Gold Coast
  "carrara": "Carrara",
  "people first stadium": "Carrara",
  "heritage bank stadium": "Carrara",
  "metricon stadium": "Carrara",
  // GWS / Sydney Showground
  "engie stadium": "Sydney Showground",
  "giants stadium": "Sydney Showground",
  "sydney showground": "Sydney Showground",
  "showground stadium": "Sydney Showground",
  // Launceston
  "utas stadium": "York Park",
  "york park": "York Park",
  // Norwood / Adelaide Hills etc. add as needed.
};

export function canonicalVenue(name: string | null | undefined): CanonicalVenue | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  // Fall back to a normalised passthrough so exact matches still work.
  return name.trim();
}
