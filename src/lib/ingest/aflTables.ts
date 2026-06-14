import { cached } from "./cache";

// ─────────────────────────────────────────────────────────────────────────────
// AFL Tables ingest — https://afltables.com/
// Historical per-player match stats by scraping. This source is HTML and can be
// flaky / change layout, so everything here degrades gracefully: on any failure
// the functions return empty data and log, rather than throwing into the UI.
//
// NOTE: This is a deliberately minimal, defensive first pass. The HTML parsing
// is intentionally conservative; expand the selectors as you verify the markup.
// ─────────────────────────────────────────────────────────────────────────────

export interface AflTablesPlayerMatch {
  player: string;
  team: string;
  opponent: string;
  round: string;
  disposals: number | null;
  marks: number | null;
  tackles: number | null;
  goals: number | null;
}

const BASE = "https://afltables.com/afl";

/**
 * Fetch a raw AFL Tables HTML page through the cache. Returns null on failure
 * so callers can degrade gracefully.
 */
async function fetchPage(url: string): Promise<string | null> {
  try {
    return await cached<string>(`afltables:${url}`, 24 * 60 * 60, async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": "AFLMultiTracker/1.0" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`AFL Tables ${url} -> ${res.status}`);
      return res.text();
    });
  } catch (err) {
    console.warn(`[afltables] fetch failed for ${url}:`, err);
    return null;
  }
}

/**
 * Placeholder season game-by-game stats fetch for a player. Returns [] until the
 * HTML parser is implemented/verified. Wiring point for historical form +
 * head-to-head history.
 */
export async function getPlayerSeasonStats(
  playerSlug: string,
  season: number,
): Promise<AflTablesPlayerMatch[]> {
  const url = `${BASE}/stats/players/${playerSlug}.html`;
  const html = await fetchPage(url);
  if (!html) return [];

  // TODO(handoff): parse the per-season stats table. AFL Tables uses plain HTML
  // tables; a lightweight regex/cheerio pass over the season block will yield
  // disposals/marks/tackles/goals. Left unimplemented so the build doesn't
  // depend on brittle scraping. See HANDOFF.md.
  void season;
  return [];
}

/** True when AFL Tables is reachable; used to show a soft "source down" badge. */
export async function aflTablesHealthy(): Promise<boolean> {
  const html = await fetchPage(`${BASE}/afl_index.html`);
  return html !== null;
}
