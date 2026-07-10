import { and, desc, eq, or } from "drizzle-orm";

import { db } from "@/db";
import { games } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { getRecentTeamForm, type FormResult } from "@/lib/data/games";
import { getSquiggleStandings } from "@/lib/ingest/squiggle";

export interface LadderSnapshot {
  rank: number;
  wins: number;
  losses: number;
  draws: number;
  pts: number;
  percentage: number;
}

export interface HeadToHeadGame {
  round: number | null;
  season: number | null;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  commenceTime: Date;
  venue: string | null;
}

export interface MatchBriefing {
  homeLadder: LadderSnapshot | null;
  awayLadder: LadderSnapshot | null;
  homeForm: FormResult[];
  awayForm: FormResult[];
  h2h: HeadToHeadGame[];
  h2hSummary: { homeWins: number; awayWins: number; draws: number } | null;
  weatherHint: string;
}

function findLadderRank(
  standings: Awaited<ReturnType<typeof getSquiggleStandings>>,
  team: string,
): LadderSnapshot | null {
  const c = canonicalTeam(team) ?? team;
  for (const s of standings) {
    const sc = canonicalTeam(s.team) ?? s.team;
    if (sc === c) {
      return {
        rank: s.rank,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        pts: s.pts,
        percentage: s.percentage,
      };
    }
  }
  return null;
}

async function getHeadToHeadGames(
  home: string,
  away: string,
  limit: number,
): Promise<HeadToHeadGame[]> {
  const rows = await db
    .select({
      round: games.round,
      season: games.season,
      home: games.home,
      away: games.away,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      commenceTime: games.commenceTime,
      venue: games.venue,
    })
    .from(games)
    .where(
      and(
        eq(games.status, "complete"),
        or(
          and(eq(games.home, home), eq(games.away, away)),
          and(eq(games.home, away), eq(games.away, home)),
        ),
      ),
    )
    .orderBy(desc(games.commenceTime))
    .limit(limit);

  return rows
    .filter((g) => g.homeScore != null && g.awayScore != null)
    .map((g) => ({
      round: g.round,
      season: g.season,
      home: g.home,
      away: g.away,
      homeScore: g.homeScore!,
      awayScore: g.awayScore!,
      commenceTime: g.commenceTime,
      venue: g.venue,
    }));
}

function h2hSummaryFromGames(
  meetings: HeadToHeadGame[],
  home: string,
  away: string,
): MatchBriefing["h2hSummary"] {
  if (meetings.length === 0) return null;
  const homeC = canonicalTeam(home) ?? home;
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  for (const m of meetings) {
    if (m.homeScore === m.awayScore) {
      draws += 1;
      continue;
    }
    const winner = m.homeScore > m.awayScore ? m.home : m.away;
    const w = canonicalTeam(winner) ?? winner;
    if (w === homeC) homeWins += 1;
    else awayWins += 1;
  }
  return { homeWins, awayWins, draws };
}

/** Ladder, form, head-to-head and a weather note for the game briefing card. */
export async function getMatchBriefing(
  home: string,
  away: string,
  season: number | null,
): Promise<MatchBriefing> {
  const homeC = canonicalTeam(home) ?? home;
  const awayC = canonicalTeam(away) ?? away;

  const [formMap, standings, h2h] = await Promise.all([
    getRecentTeamForm(),
    season != null
      ? getSquiggleStandings(season).catch(() => [] as Awaited<ReturnType<typeof getSquiggleStandings>>)
      : Promise.resolve([] as Awaited<ReturnType<typeof getSquiggleStandings>>),
    getHeadToHeadGames(homeC, awayC, 5),
  ]);

  return {
    homeLadder: findLadderRank(standings, home),
    awayLadder: findLadderRank(standings, away),
    homeForm: formMap.get(homeC) ?? [],
    awayForm: formMap.get(awayC) ?? [],
    h2h,
    h2hSummary: h2hSummaryFromGames(h2h, home, away),
    weatherHint:
      "Rain or wind at kickoff often pushes disposal totals down — check the forecast before you finalise lines.",
  };
}
