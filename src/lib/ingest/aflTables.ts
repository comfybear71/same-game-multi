import { canonicalTeam } from "@/lib/afl/teams";
import { canonicalVenue } from "@/lib/afl/venues";
import { cached } from "./cache";

// ─────────────────────────────────────────────────────────────────────────────
// AFL Tables ingest — https://afltables.com/
// Historical per-player match stats by scraping. AFL Tables is plain HTML and
// can change, so everything here degrades gracefully: on any failure the
// functions return empty data and log, rather than throwing into the UI.
//
// Player career pages live at:
//   /afl/stats/players/{FirstInitial}/{First}_{Last}.html
// Each page contains, per season, a game-by-game table with columns:
//   Gm, Opponent, Rd, R, #, KI, MK, HB, DI, GL, BH, HO, TK, ...
// (marks=idx6, disposals=idx8, goals=idx9, tackles=idx12), plus career split
// tables aggregated by Opponent and by Venue.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "https://afltables.com/afl";

export interface PlayerGameLogEntry {
  season: number;
  round: string;
  opponent: string | null; // canonical team name
  jumper: number | null; // guernsey number worn that game
  disposals: number;
  marks: number;
  tackles: number;
  goals: number;
}

export interface VenueSplit {
  venue: string; // canonical venue
  games: number;
  avgDisposals: number;
  avgMarks: number;
  avgTackles: number;
  avgGoals: number;
}

export interface PlayerHistory {
  gameLog: PlayerGameLogEntry[];
  venueSplits: VenueSplit[];
  team: string | null; // canonical team from the most recent season
  jumper: number | null; // most recent guernsey number
}

/** Build the AFL Tables URL for a player name (best effort). */
export function playerUrl(name: string, slugOverride?: string | null): string {
  if (slugOverride) {
    const initial = slugOverride.charAt(0).toUpperCase();
    return `${BASE}/stats/players/${initial}/${slugOverride}.html`;
  }
  const parts = name.trim().split(/\s+/);
  const initial = (parts[0]?.charAt(0) ?? "A").toUpperCase();
  const slug = parts.join("_");
  return `${BASE}/stats/players/${initial}/${slug}.html`;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
}

function toInt(s: string): number {
  const digits = s.replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

function toFloat(s: string): number {
  const m = s.replace(/[^0-9.]/g, "");
  return m ? parseFloat(m) : 0;
}

function rowCells(rowHtml: string): string[] {
  const cells = rowHtml.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? [];
  return cells.map((c) => stripTags(c.replace(/<t[dh][^>]*>/, "").replace(/<\/t[dh]>/, "")));
}

/** Parse the per-season game-by-game tables into a flat game log. */
export function parseGameLog(html: string): PlayerGameLogEntry[] {
  // Segment by per-season headers like ">Western Bulldogs - 2014<".
  const headerRe = />([A-Za-z][A-Za-z .]+) - (20\d\d)</g;
  const headers: { index: number; end: number; season: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(html)) !== null) {
    headers.push({ index: m.index, end: headerRe.lastIndex, season: parseInt(m[2], 10) });
  }

  const games: PlayerGameLogEntry[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].end;
    const end = i + 1 < headers.length ? headers[i + 1].index : html.length;
    const seg = html.slice(start, end);
    const season = headers[i].season;

    const rows = seg.match(/<tr>([\s\S]*?)<\/tr>/g) ?? [];
    for (const row of rows) {
      const cells = rowCells(row);
      if (cells.length < 13) continue;
      // A game row starts with the game number (possibly with ↑/↓ arrows).
      const gm = cells[0].replace(/[^0-9]/g, "");
      if (!/^\d+$/.test(gm)) continue;
      const jumperRaw = cells[4].replace(/[^0-9]/g, "");
      games.push({
        season,
        round: cells[2],
        opponent: canonicalTeam(cells[1]),
        jumper: jumperRaw ? parseInt(jumperRaw, 10) : null,
        marks: toInt(cells[6]),
        disposals: toInt(cells[8]),
        goals: toInt(cells[9]),
        tackles: toInt(cells[12]),
      });
    }
  }
  return games;
}

/** The player's team in the most recent season (canonical), if determinable. */
export function parseLatestTeam(html: string): string | null {
  const headerRe = />([A-Za-z][A-Za-z .]+) - (20\d\d)</g;
  let latest: { season: number; team: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(html)) !== null) {
    const season = parseInt(m[2], 10);
    if (!latest || season > latest.season) latest = { season, team: m[1].trim() };
  }
  return latest ? canonicalTeam(latest.team) : null;
}

/** Parse the career Venue split table (aggregate per venue). */
export function parseVenueSplits(html: string): VenueSplit[] {
  const i = html.indexOf(">Venue</th>");
  if (i < 0) return [];
  const seg = html.slice(i - 50, i + 4000);
  const rows = seg.match(/<tr>([\s\S]*?)<\/tr>/g) ?? [];
  const splits: VenueSplit[] = [];
  for (const row of rows) {
    const cells = rowCells(row);
    // Columns: Venue, P (g W-D-L), KI, MK, HB, DI, DA, GL, BH, HO, TK, ...
    if (cells.length < 11) continue;
    if (cells[0] === "Venue" || cells[0] === "") continue;
    if (!/\(\d/.test(cells[1])) continue; // P column like "17 (9-0-8)"
    const games = toInt(cells[1].match(/^(\d+)/)?.[1] ?? "0");
    if (games <= 0) continue;
    const venue = canonicalVenue(cells[0]);
    if (!venue) continue;
    splits.push({
      venue,
      games,
      avgMarks: toInt(cells[3]) / games,
      avgDisposals: toFloat(cells[6]) || toInt(cells[5]) / games, // DA if present
      avgTackles: toInt(cells[10]) / games,
      avgGoals: toInt(cells[7]) / games,
    });
  }
  return splits;
}

/** Fetch + parse a player's full history. Returns empty on any failure. */
export async function getPlayerHistory(
  name: string,
  slugOverride?: string | null,
): Promise<PlayerHistory> {
  const url = playerUrl(name, slugOverride);
  try {
    const html = await cached<string>(`afltables:${url}`, 12 * 60 * 60, async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": "AFLMultiTracker/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`AFL Tables ${url} -> ${res.status}`);
      return res.text();
    });
    const gameLog = parseGameLog(html);
    // Latest known guernsey number (walk back from the most recent game).
    let jumper: number | null = null;
    for (let i = gameLog.length - 1; i >= 0; i--) {
      if (gameLog[i].jumper != null) {
        jumper = gameLog[i].jumper;
        break;
      }
    }
    return {
      gameLog,
      venueSplits: parseVenueSplits(html),
      team: parseLatestTeam(html),
      jumper,
    };
  } catch (err) {
    console.warn(`[afltables] history failed for ${name}:`, err);
    return { gameLog: [], venueSplits: [], team: null, jumper: null };
  }
}

/** True when AFL Tables is reachable; used for a soft "source down" badge. */
export async function aflTablesHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/stats/players/M/Marcus_Bontempelli.html`, {
      method: "HEAD",
      headers: { "User-Agent": "AFLMultiTracker/1.0" },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
