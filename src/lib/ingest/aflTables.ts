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
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
  goals: number;
  fantasy: number; // AFL Fantasy points for the game (computed from raw stats)
}

export interface PlayerBio {
  dob: string | null; // ISO yyyy-mm-dd
  heightCm: number | null;
  weightKg: number | null;
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
  bio: PlayerBio;
}

// AFL Fantasy scoring weights, applied to the raw match stats.
const FANTASY = {
  kick: 3,
  handball: 2,
  mark: 3,
  tackle: 4,
  goal: 6,
  behind: 1,
  hitout: 1,
  freeFor: 1,
  freeAgainst: -1,
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

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
      // Columns: KI 5, MK 6, HB 7, DI 8, GL 9, BH 10, HO 11, TK 12, … FF 17, FA 18.
      const ff = cells.length > 17 ? toInt(cells[17]) : 0;
      const fa = cells.length > 18 ? toInt(cells[18]) : 0;
      const fantasy =
        toInt(cells[5]) * FANTASY.kick +
        toInt(cells[7]) * FANTASY.handball +
        toInt(cells[6]) * FANTASY.mark +
        toInt(cells[12]) * FANTASY.tackle +
        toInt(cells[9]) * FANTASY.goal +
        toInt(cells[10]) * FANTASY.behind +
        toInt(cells[11]) * FANTASY.hitout +
        ff * FANTASY.freeFor +
        fa * FANTASY.freeAgainst;
      games.push({
        season,
        round: cells[2],
        opponent: canonicalTeam(cells[1]),
        jumper: jumperRaw ? parseInt(jumperRaw, 10) : null,
        kicks: toInt(cells[5]),
        marks: toInt(cells[6]),
        handballs: toInt(cells[7]),
        disposals: toInt(cells[8]),
        goals: toInt(cells[9]),
        tackles: toInt(cells[12]),
        fantasy,
      });
    }
  }
  return games;
}

/** Parse the bio header ("Born: 24-Nov-1995 … Height: 193 cm Weight: 93 kg"). */
export function parseBio(html: string): PlayerBio {
  const head = html.slice(0, 2500).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const born = head.match(/Born:\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  let dob: string | null = null;
  if (born) {
    const mm = MONTHS[born[2].toLowerCase()];
    if (mm) dob = `${born[3]}-${mm}-${born[1].padStart(2, "0")}`;
  }
  const h = head.match(/Height:\s*(\d+)\s*cm/);
  const w = head.match(/Weight:\s*(\d+)\s*kg/);
  return {
    dob,
    heightCm: h ? parseInt(h[1], 10) : null,
    weightKg: w ? parseInt(w[1], 10) : null,
  };
}

/** Mean AFL Fantasy points over the most recent `window` games. */
export function recentFantasyAverage(
  log: PlayerGameLogEntry[],
  window = 5,
): number | null {
  const vals = log.slice(-window).map((g) => g.fantasy);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
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

// Bookmakers often use a player's formal first name where AFL Tables uses the
// common short form (and vice versa). Try these nickname variants when the
// direct lookup finds nothing.
const FIRST_NAME_NICKNAMES: Record<string, string[]> = {
  jackson: ["jack"],
  daniel: ["dan", "danny"],
  lachlan: ["lachie", "lachy"],
  joseph: ["joe"],
  mitchito: ["mitch"],
  mitchell: ["mitch"],
  alixzander: ["alix"],
  matthew: ["matt"],
  nicholas: ["nick", "nic"],
  samuel: ["sam"],
  benjamin: ["ben"],
  thomas: ["tom"],
  harrison: ["harry"],
  zachary: ["zac", "zach"],
  maximilian: ["max"],
  cameron: ["cam"],
  anthony: ["tony"],
  michael: ["mick", "mike"],
  patrick: ["paddy", "pat"],
  william: ["will", "billy"],
  joshua: ["josh"],
  christopher: ["chris"],
  timothy: ["tim"],
  dominic: ["dom"],
  oliver: ["ollie"],
  edward: ["ed", "ned"],
};

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Candidate full names to try (formal first, then nickname variants). */
function nameCandidates(name: string): string[] {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return [name];
  const first = parts[0].toLowerCase();
  const rest = parts.slice(1).join(" ");
  const out = [name];
  for (const nick of FIRST_NAME_NICKNAMES[first] ?? []) {
    out.push(`${cap(nick)} ${rest}`);
  }
  return out;
}

function emptyHistory(): PlayerHistory {
  return {
    gameLog: [],
    venueSplits: [],
    team: null,
    jumper: null,
    bio: { dob: null, heightCm: null, weightKg: null },
  };
}

/** Fetch + parse one AFL Tables URL. Returns null if missing/empty. */
async function fetchHistoryAt(url: string): Promise<PlayerHistory | null> {
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
    if (gameLog.length === 0) return null;
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
      bio: parseBio(html),
    };
  } catch {
    return null;
  }
}

/** Fetch + parse a player's history, trying nickname variants. */
export async function getPlayerHistory(
  name: string,
  slugOverride?: string | null,
): Promise<PlayerHistory> {
  if (slugOverride) {
    return (await fetchHistoryAt(playerUrl(name, slugOverride))) ?? emptyHistory();
  }
  for (const candidate of nameCandidates(name)) {
    const history = await fetchHistoryAt(playerUrl(candidate));
    if (history) return history;
  }
  console.warn(`[afltables] no history for ${name}`);
  return emptyHistory();
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
