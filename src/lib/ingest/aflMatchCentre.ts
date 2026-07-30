/**
 * AFL Match Centre (api.afl.com.au) — unofficial CFS JSON used by fitzRoy and
 * community tools. Requires a short-lived anonymous token (WMCTok).
 * Read-only; fail soft like other ingest modules.
 */

import { canonicalTeam } from "@/lib/afl/teams";

const AFL_API = "https://api.afl.com.au";
const AFL_V2 = "https://aflapi.afl.com.au/afl/v2";
const AFLM_COMPETITION_ID = 1;
const UA = "AFLMultiTracker/1.0 (live-stats; private group)";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function aflFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "User-Agent": UA,
      ...(init.headers ?? {}),
    },
  });
}

/** Anonymous MIS token — POST with no body. Cached ~45 minutes in-process. */
export async function getAflMediaToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  try {
    const res = await aflFetch(`${AFL_API}/cfs/afl/WMCTok`, { method: "POST" });
    if (!res.ok) {
      console.warn(`[afl-match-centre] WMCTok ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { token?: string };
    if (!json.token) return null;
    cachedToken = { token: json.token, expiresAt: Date.now() + 45 * 60 * 1000 };
    return json.token;
  } catch (err) {
    console.warn("[afl-match-centre] WMCTok failed:", err);
    return null;
  }
}

interface CompSeasonRow {
  id: number;
  name: string;
}

export async function findAflCompSeasonId(season: number): Promise<number | null> {
  try {
    const res = await aflFetch(
      `${AFL_V2}/competitions/${AFLM_COMPETITION_ID}/compseasons?pageSize=100`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { compSeasons?: CompSeasonRow[] };
    const row = (json.compSeasons ?? []).find(
      (s) => /Legacy/i.test(s.name) === false && new RegExp(String(season)).test(s.name),
    );
    return row?.id ?? null;
  } catch (err) {
    console.warn(`[afl-match-centre] compSeason ${season}:`, err);
    return null;
  }
}

interface RoundRow {
  id: number;
  roundNumber: number;
  providerId: string;
}

export async function findAflRoundProviderId(
  compSeasonId: number,
  roundNumber: number,
): Promise<string | null> {
  try {
    const res = await aflFetch(
      `${AFL_V2}/compseasons/${compSeasonId}/rounds?pageSize=40`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { rounds?: RoundRow[] };
    const row = (json.rounds ?? []).find((r) => r.roundNumber === roundNumber);
    return row?.providerId ?? null;
  } catch (err) {
    console.warn(`[afl-match-centre] round ${roundNumber}:`, err);
    return null;
  }
}

export interface AflMatchListItem {
  aflMatchId: string;
  status: string;
  home: string;
  away: string;
}

export async function fetchAflRoundMatches(
  roundProviderId: string,
  token: string,
): Promise<AflMatchListItem[]> {
  const res = await aflFetch(`${AFL_API}/cfs/afl/matchItems/round/${roundProviderId}`, {
    headers: { "x-media-mis-token": token },
  });
  if (!res.ok) {
    throw new Error(`matchItems round ${roundProviderId} -> ${res.status}`);
  }
  const json = (await res.json()) as {
    items?: Array<{
      match?: {
        matchId?: string;
        status?: string;
        homeTeam?: { name?: string };
        awayTeam?: { name?: string };
      };
    }>;
  };
  const out: AflMatchListItem[] = [];
  for (const item of json.items ?? []) {
    const m = item.match;
    if (!m?.matchId) continue;
    const home = canonicalTeam(m.homeTeam?.name ?? "") ?? m.homeTeam?.name ?? "";
    const away = canonicalTeam(m.awayTeam?.name ?? "") ?? m.awayTeam?.name ?? "";
    out.push({
      aflMatchId: m.matchId,
      status: m.status ?? "UNKNOWN",
      home,
      away,
    });
  }
  return out;
}

export function resolveAflMatchId(
  matches: AflMatchListItem[],
  home: string,
  away: string,
): AflMatchListItem | null {
  const homeC = canonicalTeam(home) ?? home;
  const awayC = canonicalTeam(away) ?? away;
  for (const m of matches) {
    if (m.home === homeC && m.away === awayC) return m;
    if (m.home === awayC && m.away === homeC) return m;
  }
  return null;
}

/** AFL statuses that may have in-game player stats. */
export function aflMatchIsLiveOrPlaying(status: string): boolean {
  const s = status.toUpperCase();
  return (
    s === "LIVE" ||
    s === "PLAYING" ||
    s === "IN_PROGRESS" ||
    s === "IN_PROGRESS_CONFIRMED" ||
    s === "QUARTER_TIME" ||
    s === "HALF_TIME" ||
    s === "THREE_QUARTER_TIME"
  );
}

export interface ParsedLivePlayerRow {
  playerId: string;
  playerName: string;
  team: string;
  goals: number;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
}

type RawPlayerStatRow = {
  player?: {
    player?: {
      player?: {
        playerId?: string;
        playerName?: { givenName?: string; surname?: string };
      };
    };
  };
  playerStats?: {
    stats?: {
      goals?: number;
      kicks?: number;
      handballs?: number;
      disposals?: number;
      marks?: number;
      tackles?: number;
    };
  };
};

function parseName(row: RawPlayerStatRow): string {
  const n = row.player?.player?.player?.playerName;
  if (!n) return "Unknown";
  return [n.givenName, n.surname].filter(Boolean).join(" ").trim() || "Unknown";
}

function parsePlayerId(row: RawPlayerStatRow): string {
  return row.player?.player?.player?.playerId?.trim() || parseName(row);
}

export function parseAflPlayerStatRows(
  homeRows: RawPlayerStatRow[] | undefined,
  awayRows: RawPlayerStatRow[] | undefined,
  homeTeam: string,
  awayTeam: string,
): ParsedLivePlayerRow[] {
  const out: ParsedLivePlayerRow[] = [];
  const push = (rows: RawPlayerStatRow[] | undefined, team: string) => {
    for (const row of rows ?? []) {
      const stats = row.playerStats?.stats;
      const kicks = Number(stats?.kicks ?? 0);
      const handballs = Number(stats?.handballs ?? 0);
      let disposals = Number(stats?.disposals ?? 0);
      if (!disposals && (kicks || handballs)) disposals = kicks + handballs;
      out.push({
        playerId: parsePlayerId(row),
        playerName: parseName(row),
        team,
        goals: Number(stats?.goals ?? 0),
        kicks,
        handballs,
        disposals,
        marks: Number(stats?.marks ?? 0),
        tackles: Number(stats?.tackles ?? 0),
      });
    }
  };
  push(homeRows, homeTeam);
  push(awayRows, awayTeam);
  return out;
}

export async function fetchAflMatchPlayerStats(
  aflMatchId: string,
  token: string,
  homeTeam: string,
  awayTeam: string,
): Promise<ParsedLivePlayerRow[]> {
  const res = await aflFetch(`${AFL_API}/cfs/afl/playerStats/match/${aflMatchId}`, {
    headers: { "x-media-mis-token": token },
  });
  if (!res.ok) {
    throw new Error(`playerStats match ${aflMatchId} -> ${res.status}`);
  }
  const json = (await res.json()) as {
    homeTeamPlayerStats?: RawPlayerStatRow[];
    awayTeamPlayerStats?: RawPlayerStatRow[];
  };
  return parseAflPlayerStatRows(
    json.homeTeamPlayerStats,
    json.awayTeamPlayerStats,
    homeTeam,
    awayTeam,
  );
}
