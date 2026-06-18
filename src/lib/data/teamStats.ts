import { currentSeason } from "@/lib/cron";
import { getTeamSeasonStats } from "@/lib/ingest/wheelo";
import {
  teamRankings,
  teamRatios,
  type TeamRanking,
  type TeamRatios,
} from "@/lib/predictions/teamMatchup";

export type { TeamRatios, TeamRanking };

/** Team for/against ratios vs league average, season-to-date (Wheelo, cached ~3h). */
export async function getTeamRatios(season = currentSeason()): Promise<Map<string, TeamRatios>> {
  const board = await getTeamSeasonStats(season);
  return teamRatios(board);
}

/** League rank (1 = most) per team per stat, season-to-date (Wheelo, cached ~3h). */
export async function getTeamRankings(
  season = currentSeason(),
): Promise<Map<string, TeamRanking>> {
  const board = await getTeamSeasonStats(season);
  return teamRankings(board);
}
