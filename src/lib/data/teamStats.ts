import { currentSeason } from "@/lib/cron";
import { getTeamSeasonStats } from "@/lib/ingest/wheelo";
import { teamRatios, type TeamRatios } from "@/lib/predictions/teamMatchup";

export type { TeamRatios };

/** Team for/against ratios vs league average, season-to-date (Wheelo, cached ~3h). */
export async function getTeamRatios(season = currentSeason()): Promise<Map<string, TeamRatios>> {
  const board = await getTeamSeasonStats(season);
  return teamRatios(board);
}
