import { env } from "@/lib/env";
import { canonicalTeam } from "@/lib/afl/teams";
import { cached, cachedLive } from "./cache";

// ─────────────────────────────────────────────────────────────────────────────
// Squiggle API client — https://api.squiggle.com.au/
// Free, no key. Their rules require a descriptive User-Agent identifying the
// app and a contact. We set that from SQUIGGLE_CONTACT.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "https://api.squiggle.com.au/";

export interface SquiggleGame {
  id: number;
  round: number;
  year: number;
  hteam: string;
  ateam: string;
  hscore: number | null;
  ascore: number | null;
  venue: string;
  date: string; // "2026-06-14 17:40:00" — AEST/local; treat as Australia/Melbourne wall time
  tz: string;
  complete: number; // 0..100 (% complete)
  winner: string | null;
  timestr?: string | null; // live clock, e.g. "Q2 17:29" or "Full Time"
}

export interface LiveGameState {
  status: "scheduled" | "live" | "final";
  timestr: string | null;
  homeScore: number | null;
  awayScore: number | null;
  complete: number;
}

export interface SquiggleStanding {
  team: string;
  rank: number;
  wins: number;
  losses: number;
  draws: number;
  percentage: number;
  pts: number;
}

/** Cloudflare in front of Squiggle blocks User-Agent strings containing `@`. */
function squiggleUserAgent(raw: string): string {
  if (!raw.includes("@")) return raw;
  return raw
    .replace(/@/g, "-at-")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function squiggleFetch<T>(query: string): Promise<T> {
  const url = `${BASE}?${query}`;
  const ua = squiggleUserAgent(env.SQUIGGLE_CONTACT);
  const res = await fetch(url, {
    headers: { "User-Agent": ua },
    cache: "no-store",
  });
  if (!res.ok) {
    const snippet = res.status === 403 ? " (check SQUIGGLE_CONTACT — no @ in User-Agent)" : "";
    throw new Error(`Squiggle ${query} failed: ${res.status} ${res.statusText}${snippet}`);
  }
  return (await res.json()) as T;
}

/** Fixtures + results for a season (optionally a single round). */
export async function getSquiggleGames(
  year: number,
  round?: number,
): Promise<SquiggleGame[]> {
  const q = round
    ? `q=games;year=${year};round=${round}`
    : `q=games;year=${year}`;
  const key = `squiggle:games:${year}:${round ?? "all"}`;
  // Cache 30 min — fixtures rarely move, results lag the live game anyway.
  const data = await cached<{ games: SquiggleGame[] }>(key, 30 * 60, () =>
    squiggleFetch<{ games: SquiggleGame[] }>(q),
  );
  return data.games ?? [];
}

/** Ladder / standings for a season. */
export async function getSquiggleStandings(
  year: number,
): Promise<SquiggleStanding[]> {
  const key = `squiggle:standings:${year}`;
  const data = await cached<{ standings: SquiggleStanding[] }>(
    key,
    6 * 60 * 60,
    () => squiggleFetch<{ standings: SquiggleStanding[] }>(`q=standings;year=${year}`),
  );
  return data.standings ?? [];
}

/** One round, straight from Squiggle — no long-lived cache (game-over / live refresh). */
export async function fetchSquiggleRound(
  year: number,
  round: number,
): Promise<SquiggleGame[]> {
  const data = await squiggleFetch<{ games: SquiggleGame[] }>(
    `q=games;year=${year};round=${round}`,
  );
  return data.games ?? [];
}

/** Completed games (complete === 100) for settling results. */
export async function getCompletedSquiggleGames(
  year: number,
  round?: number,
): Promise<SquiggleGame[]> {
  const games = await getSquiggleGames(year, round);
  return games.filter((g) => g.complete === 100);
}

function findSquiggleGame(
  games: SquiggleGame[],
  home: string,
  away: string,
): { game: SquiggleGame; flip: boolean } | null {
  const homeC = canonicalTeam(home) ?? home;
  const awayC = canonicalTeam(away) ?? away;
  for (const x of games) {
    const h = canonicalTeam(x.hteam) ?? x.hteam;
    const a = canonicalTeam(x.ateam) ?? x.ateam;
    if (h === homeC && a === awayC) return { game: x, flip: false };
    if (h === awayC && a === homeC) return { game: x, flip: true };
  }
  return null;
}

function squiggleGameToState(g: SquiggleGame, flip = false): LiveGameState {
  const status: LiveGameState["status"] =
    g.complete >= 100 ? "final" : g.complete > 0 ? "live" : "scheduled";
  return {
    status,
    timestr: g.timestr ?? null,
    homeScore: flip ? g.ascore : g.hscore,
    awayScore: flip ? g.hscore : g.ascore,
    complete: g.complete,
  };
}

function squiggleMatchesFixture(g: SquiggleGame, home: string, away: string): boolean {
  const homeC = canonicalTeam(home) ?? home;
  const awayC = canonicalTeam(away) ?? away;
  const h = canonicalTeam(g.hteam) ?? g.hteam;
  const a = canonicalTeam(g.ateam) ?? g.ateam;
  return (h === homeC && a === awayC) || (h === awayC && a === homeC);
}

function pickSquiggleMatch(
  games: SquiggleGame[],
  squiggleId: number | null,
  home: string,
  away: string,
): { game: SquiggleGame; flip: boolean } | null {
  // Team names are authoritative — squiggleId in our DB can be wrong/stale.
  const byTeams = findSquiggleGame(games, home, away);
  if (byTeams) return byTeams;

  if (squiggleId != null) {
    const g = games.find((x) => x.id === squiggleId);
    if (g && squiggleMatchesFixture(g, home, away)) {
      const homeC = canonicalTeam(home) ?? home;
      const squiggleHome = canonicalTeam(g.hteam) ?? g.hteam;
      return { game: g, flip: squiggleHome !== homeC };
    }
  }
  return null;
}

/** Match a Squiggle row to our fixture — team names first, then verified squiggleId. */
export function matchSquiggleFixture(
  games: SquiggleGame[],
  squiggleId: number | null,
  home: string,
  away: string,
): { game: SquiggleGame; flip: boolean } | null {
  return pickSquiggleMatch(games, squiggleId, home, away);
}

/** Live score/clock — match by team names first, then squiggle id. */
export async function resolveLiveGameState(
  year: number,
  round: number,
  squiggleId: number | null,
  home: string,
  away: string,
): Promise<(LiveGameState & { squiggleId?: number }) | null> {
  const key = `squiggle:live:v3:${year}:${round}`;
  let data = await cachedLive<{ games: SquiggleGame[] }>(key, 10, () =>
    squiggleFetch<{ games: SquiggleGame[] }>(`q=games;year=${year};round=${round}`),
  );
  let games = data.games ?? [];

  let match = pickSquiggleMatch(games, squiggleId, home, away);
  let state = match ? squiggleGameToState(match.game, match.flip) : null;

  // Cached round snapshot can lag — one fresh Squiggle pull if no match or no real scores.
  if (
    !state ||
    (state.status === "live" &&
      (state.homeScore ?? 0) === 0 &&
      (state.awayScore ?? 0) === 0)
  ) {
    data = await squiggleFetch<{ games: SquiggleGame[] }>(
      `q=games;year=${year};round=${round}`,
    );
    games = data.games ?? [];
    match = pickSquiggleMatch(games, squiggleId, home, away);
    state = match ? squiggleGameToState(match.game, match.flip) : state;
  }

  if (!state || !match) return null;
  return { ...state, squiggleId: match.game.id };
}
