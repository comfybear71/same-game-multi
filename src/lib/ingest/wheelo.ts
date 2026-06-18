import type { StatType } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { cached } from "./cache";

// ─────────────────────────────────────────────────────────────────────────────
// Wheelo Ratings — https://www.wheeloratings.com/afl_stats.html
// Publishes Champion-Data-sourced team season aggregates as a public JSON feed
// behind their stats dashboard. Not a documented API, so: read only the four
// basic counting stats (for + against) that are also public on AFL Tables —
// not their proprietary advanced metrics — and fail soft like every other
// source in this directory (empty result + log, never throw into the UI).
// ─────────────────────────────────────────────────────────────────────────────

const STATS: StatType[] = ["disposals", "marks", "tackles", "goals"];

const COLUMN: Record<StatType, string> = {
  disposals: "Disposals",
  marks: "Marks",
  tackles: "Tackles",
  goals: "Goals",
};

function zeroRecord(): Record<StatType, number> {
  return { disposals: 0, marks: 0, tackles: 0, goals: 0 };
}

/** One team's season-to-date per-game averages, for (scored) and against (conceded). */
export interface TeamSeasonStats {
  team: string; // canonical team name
  matches: number;
  for: Record<StatType, number>;
  against: Record<StatType, number>;
}

export interface SeasonTeamStats {
  teams: TeamSeasonStats[];
  leagueAverage: { for: Record<StatType, number>; against: Record<StatType, number> };
}

interface WheeloTeamStatsResponse {
  Data: Record<string, Array<number | string | null>>;
}

/** The feed is column-oriented (one array per field, aligned by index) with a "Average" pseudo-row. */
function parseTeamStats(json: WheeloTeamStatsResponse): SeasonTeamStats {
  const cols = json.Data ?? {};
  const names = (cols.Team ?? []) as string[];
  const matchesCol = (cols.Matches ?? []) as number[];

  const teams: TeamSeasonStats[] = [];
  let leagueAverage = { for: zeroRecord(), against: zeroRecord() };

  for (let i = 0; i < names.length; i++) {
    const forRec = zeroRecord();
    const againstRec = zeroRecord();
    for (const stat of STATS) {
      forRec[stat] = Number(cols[COLUMN[stat]]?.[i] ?? 0);
      againstRec[stat] = Number(cols[`${COLUMN[stat]}_Opposition`]?.[i] ?? 0);
    }
    if (names[i] === "Average") {
      leagueAverage = { for: forRec, against: againstRec };
      continue;
    }
    const team = canonicalTeam(names[i]);
    if (!team) continue;
    teams.push({ team, matches: Number(matchesCol[i] ?? 0), for: forRec, against: againstRec });
  }
  return { teams, leagueAverage };
}

/** Season-to-date team for/against averages (disposals, marks, tackles, goals). */
export async function getTeamSeasonStats(season: number): Promise<SeasonTeamStats> {
  const key = `wheelo:team_stats:${season}`;
  try {
    return await cached(key, 3 * 60 * 60, async () => {
      const res = await fetch(
        `https://www.wheeloratings.com/src/afl_stats/team_stats/afl/${season}.json`,
        {
          headers: { "User-Agent": "AFLMultiTracker/1.0" },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) throw new Error(`wheelo team_stats ${season} -> ${res.status}`);
      return parseTeamStats((await res.json()) as WheeloTeamStatsResponse);
    });
  } catch (err) {
    console.warn(`[wheelo] team_stats unavailable for ${season}:`, err);
    return { teams: [], leagueAverage: { for: zeroRecord(), against: zeroRecord() } };
  }
}
