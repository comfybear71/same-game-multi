import {
  HARVEST_MARKETS,
  ODDS_API_SPORT,
  harvestMarketsCsv,
  unmappedMarkets,
} from "@/lib/odds/markets";
import {
  assertQuotaFloor,
  parseQuotaHeaders,
  type QuotaStatus,
} from "@/lib/odds/quota";

const BASE = "https://api.the-odds-api.com/v4";

export type OddsEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
};

export type EventOddsResponse = {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: unknown[];
};

async function oddsFetch(
  path: string,
  apiKey: string,
  quotaFloor: number,
): Promise<{ json: unknown; quota: QuotaStatus }> {
  const url = path.includes("?")
    ? `${BASE}${path}&apiKey=${encodeURIComponent(apiKey)}`
    : `${BASE}${path}?apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const quota = parseQuotaHeaders(res.headers);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Odds API ${res.status}: ${body.slice(0, 200)}`);
  }
  assertQuotaFloor(quota, quotaFloor);
  return { json: await res.json(), quota };
}

export async function listSports(
  apiKey: string,
  quotaFloor: number,
): Promise<{ keys: string[]; quota: QuotaStatus }> {
  const { json, quota } = await oddsFetch("/sports", apiKey, quotaFloor);
  const keys = (json as { key: string }[]).map((s) => s.key);
  return { keys, quota };
}

export async function listAflEvents(
  apiKey: string,
  quotaFloor: number,
): Promise<{ events: OddsEvent[]; quota: QuotaStatus }> {
  const { json, quota } = await oddsFetch(
    `/sports/${ODDS_API_SPORT}/events`,
    apiKey,
    quotaFloor,
  );
  return { events: json as OddsEvent[], quota };
}

export async function fetchEventPlayerProps(
  apiKey: string,
  eventId: string,
  quotaFloor: number,
): Promise<{ data: EventOddsResponse; quota: QuotaStatus }> {
  const markets = harvestMarketsCsv();
  const path =
    `/sports/${ODDS_API_SPORT}/events/${eventId}/odds` +
    `?regions=au&oddsFormat=decimal&markets=${encodeURIComponent(markets)}`;
  const { json, quota } = await oddsFetch(path, apiKey, quotaFloor);
  return { data: json as EventOddsResponse, quota };
}

/** Log which documented AFL player props we are not requesting. */
export function logSkippedMarkets(): string[] {
  return unmappedMarkets([
    ...HARVEST_MARKETS,
    "player_goal_scorer_first",
    "player_goal_scorer_last",
    "player_goal_scorer_anytime",
    "player_marks_most",
    "player_tackles_most",
    "player_afl_fantasy_points_most",
    "player_clearances_over",
    "player_kicks_over",
    "player_handballs_over",
  ]);
}
