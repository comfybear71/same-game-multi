import type { StatType } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import type { SeasonTeamStats } from "@/lib/ingest/wheelo";

// How much more (or less) than league-average a team scores ("for") or leaks
// ("against") a stat, season-to-date — the foundation for the team matchup
// factor folded into Model C and the fixture-card "leads tackles" callouts.
// Pure, no DB import: safe for both the prediction engine and server
// components that just want a display label.

export const STATS: StatType[] = ["disposals", "marks", "tackles", "goals"];

export const STAT_LABEL: Record<StatType, string> = {
  disposals: "disposals",
  marks: "marks",
  tackles: "tackles",
  goals: "goals",
};

// Team aggregates are noisier early in the season than a player's own form;
// this shrinks the ratio toward 1.0 until enough games have been played.
const SHRINK_K = 8;

function ratio(value: number, leagueAvg: number): number {
  return leagueAvg > 0 ? value / leagueAvg : 1;
}

function shrink(r: number, matches: number): number {
  if (!Number.isFinite(r) || r <= 0) return 1;
  const weight = matches / (matches + SHRINK_K);
  return 1 + (r - 1) * weight;
}

export interface TeamRatios {
  team: string;
  matches: number;
  /** Ratio vs league average, e.g. 1.1 = scores 10% more of this stat than average. */
  for: Record<StatType, number>;
  /** Ratio vs league average, e.g. 1.1 = concedes 10% more of this stat than average. */
  against: Record<StatType, number>;
}

export function teamRatios(board: SeasonTeamStats): Map<string, TeamRatios> {
  const out = new Map<string, TeamRatios>();
  for (const t of board.teams) {
    const forRec = {} as Record<StatType, number>;
    const againstRec = {} as Record<StatType, number>;
    for (const stat of STATS) {
      forRec[stat] = ratio(t.for[stat], board.leagueAverage.for[stat]);
      againstRec[stat] = ratio(t.against[stat], board.leagueAverage.against[stat]);
    }
    out.set(t.team, { team: t.team, matches: t.matches, for: forRec, against: againstRec });
  }
  return out;
}

/**
 * Combined "is this a good matchup for team T's stat S" factor: T's own
 * scoring strength blended with how much opponent O leaks the same stat, each
 * shrunk toward 1.0 by games played. >1 favours T's players in stat S. Denser
 * and more current than the player-vs-opponent factor in features.ts (which
 * is usually 0-2 career meetings and shrinks back to ~1).
 */
export function matchupFactor(
  ratios: Map<string, TeamRatios>,
  team: string,
  opponent: string | null,
  stat: StatType,
): number {
  const t = ratios.get(team);
  if (!t) return 1;
  const tFor = shrink(t.for[stat], t.matches);
  if (!opponent) return tFor;
  const o = ratios.get(opponent);
  if (!o) return tFor;
  const oAgainst = shrink(o.against[stat], o.matches);
  return Math.sqrt(tFor * oAgainst);
}

/** Which side has the statistical edge for `stat` in this matchup, if either, above a noise threshold. */
export function matchupEdge(
  ratios: Map<string, TeamRatios>,
  home: string,
  away: string,
  stat: StatType,
  threshold = 1.08,
): string | null {
  const homeScore = matchupFactor(ratios, home, away, stat);
  const awayScore = matchupFactor(ratios, away, home, stat);
  if (homeScore / awayScore >= threshold) return home;
  if (awayScore / homeScore >= threshold) return away;
  return null;
}

/** Which side leads each stat in this fixture, if either; null when we have no ratios for either team. */
export function fixtureMatchupEdges(
  ratios: Map<string, TeamRatios>,
  home: string,
  away: string,
): Record<StatType, string | null> | null {
  const h = canonicalTeam(home) ?? home;
  const a = canonicalTeam(away) ?? away;
  if (!ratios.has(h) || !ratios.has(a)) return null;
  const out = {} as Record<StatType, string | null>;
  for (const stat of STATS) out[stat] = matchupEdge(ratios, h, a, stat);
  return out;
}
