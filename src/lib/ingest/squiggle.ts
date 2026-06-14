import { env } from "@/lib/env";
import { cached } from "./cache";

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

async function squiggleFetch<T>(query: string): Promise<T> {
  const url = `${BASE}?${query}`;
  const res = await fetch(url, {
    headers: { "User-Agent": env.SQUIGGLE_CONTACT },
    // Squiggle data changes slowly; let our own cache layer govern freshness.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Squiggle ${query} failed: ${res.status} ${res.statusText}`);
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

/** Completed games (complete === 100) for settling results. */
export async function getCompletedSquiggleGames(
  year: number,
  round?: number,
): Promise<SquiggleGame[]> {
  const games = await getSquiggleGames(year, round);
  return games.filter((g) => g.complete === 100);
}
