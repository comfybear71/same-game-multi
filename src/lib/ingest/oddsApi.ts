import { env } from "@/lib/env";
import { cached } from "./cache";

// ─────────────────────────────────────────────────────────────────────────────
// The Odds API client — https://the-odds-api.com/
// PAID tier with player props enabled. Key lives ONLY in ODDS_API_KEY.
// AFL only: sport key is hardcoded to `aussierules_afl`.
//
// Usage is metered, so:
//   - fixtures + h2h is one call (cheap, cached 1h)
//   - player props require a per-event call; we loop event IDs and cache each
//     aggressively (default 3h) to keep cost down.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "aussierules_afl";
const REGIONS = "au";
const PROP_MARKETS = "player_disposals,player_marks,player_tackles,player_goals";

export interface OddsOutcome {
  name: string; // team name (h2h) or "Over"/"Under" (props) or player name
  description?: string; // player name for props markets
  price: number; // decimal odds
  point?: number; // the line for props
}

export interface OddsMarket {
  key: string; // "h2h" | "player_disposals" | ...
  outcomes: OddsOutcome[];
}

export interface OddsBookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

export interface OddsEvent {
  id: string;
  sport_key: string;
  commence_time: string; // ISO UTC
  home_team: string;
  away_team: string;
  bookmakers?: OddsBookmaker[];
}

function assertKey() {
  if (!env.ODDS_API_KEY) {
    throw new Error(
      "ODDS_API_KEY is not set. Add your paid The Odds API key to the environment.",
    );
  }
}

async function oddsFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  assertKey();
  const qs = new URLSearchParams({ apiKey: env.ODDS_API_KEY, ...params });
  const res = await fetch(`${BASE}${path}?${qs.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Odds API ${path} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  // Surface remaining quota in logs to help manage cost.
  const remaining = res.headers.get("x-requests-remaining");
  if (remaining) console.log(`[odds] requests remaining: ${remaining}`);
  return (await res.json()) as T;
}

/** Fixtures + head-to-head odds. One cheap call, cached 1h. */
export async function getFixturesWithH2H(): Promise<OddsEvent[]> {
  return cached<OddsEvent[]>("odds:fixtures", 60 * 60, () =>
    oddsFetch<OddsEvent[]>(`/sports/${SPORT}/odds`, {
      regions: REGIONS,
      markets: "h2h",
      oddsFormat: "decimal",
    }),
  );
}

/** Player prop lines for a single event. Per-event call — cache aggressively. */
export async function getPlayerProps(eventId: string): Promise<OddsEvent> {
  return cached<OddsEvent>(`odds:props:${eventId}`, 3 * 60 * 60, () =>
    oddsFetch<OddsEvent>(`/sports/${SPORT}/events/${eventId}/odds`, {
      regions: REGIONS,
      markets: PROP_MARKETS,
      oddsFormat: "decimal",
    }),
  );
}

/** Map an Odds API prop market key to our internal stat type. */
export function marketKeyToStat(
  key: string,
): "disposals" | "marks" | "tackles" | "goals" | null {
  switch (key) {
    case "player_disposals":
      return "disposals";
    case "player_marks":
      return "marks";
    case "player_tackles":
      return "tackles";
    case "player_goals":
      return "goals";
    default:
      return null;
  }
}
