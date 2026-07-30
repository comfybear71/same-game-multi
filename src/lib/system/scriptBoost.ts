import type { StatType } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import {
  matchupFactor,
  type TeamRatios,
} from "@/lib/predictions/teamMatchup";
import { normaliseLineupPosition } from "@/lib/system/roleMarket";

/** Ladder rank 1 = top; lower rank number = stronger side. */
function isClearFavourite(
  teamRank: number | null,
  oppRank: number | null,
  gap = 4,
): boolean {
  if (teamRank == null || oppRank == null) return false;
  return teamRank + gap <= oppRank;
}

/**
 * Team stat matchup + ladder mismatch → soft points for portfolio fill.
 * Favourite backs boosted for marks/disposals when belting a weak side; underdog forwards damped on goals.
 */
export function matchupScriptSoftPoints(opts: {
  team: string;
  opponent: string | null;
  stat: StatType;
  position: string | null | undefined;
  ratios: Map<string, TeamRatios> | null;
  homeTeam: string;
  awayTeam: string;
  homeLadderRank: number | null;
  awayLadderRank: number | null;
}): number {
  const {
    team,
    opponent,
    stat,
    position,
    ratios,
    homeTeam,
    homeLadderRank,
    awayLadderRank,
  } = opts;
  if (!opponent || !ratios) return 0;

  const teamC = canonicalTeam(team) ?? team;
  const homeC = canonicalTeam(homeTeam) ?? homeTeam;
  const mf = matchupFactor(ratios, teamC, opponent, stat);
  let pts = (mf - 1) * 20;

  const teamRank =
    teamC === (canonicalTeam(homeTeam) ?? homeTeam)
      ? homeLadderRank
      : awayLadderRank;
  const oppRank =
    opponent === homeC ? homeLadderRank : awayLadderRank;
  const p = normaliseLineupPosition(position);

  if (isClearFavourite(teamRank, oppRank)) {
    if (stat === "marks" || stat === "disposals") {
      if (p === "FB" || p === "HB") pts += 10;
    }
    if (stat === "goals" && (p === "FF" || p === "HF")) pts += 8;
  }
  if (isClearFavourite(oppRank, teamRank)) {
    if (stat === "goals" && (p === "FF" || p === "HF")) pts -= 10;
    if (stat === "marks" && (p === "FF" || p === "HF")) pts -= 6;
  }

  return Math.round(pts * 10) / 10;
}
