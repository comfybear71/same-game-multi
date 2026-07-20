import type { PlayerGameLogEntry, PlayerHistory } from "@/lib/ingest/aflTables";
import type { PredictionInput, StatType } from "./types";

// Derive model inputs from a player's AFL Tables history for one upcoming game.
//
//   seasonAverage  — mean of the stat in the current season (falls back to the
//                    most recent season with data, or career, when thin).
//   recentForm     — most-recent-first list of the stat across recent games.
//   opponentFactor — player's mean vs this opponent ÷ career mean, shrunk toward
//                    1.0 by sample size (small samples pulled to neutral).
//   venueFactor    — player's mean at this venue ÷ career mean, similarly shrunk.

export const STAT_TYPES: StatType[] = ["disposals", "marks", "tackles", "goals"];

// Shrinkage constant: factor pulled toward 1.0 unless we have enough games.
const SHRINK_K = 4;

function statValue(g: PlayerGameLogEntry, stat: StatType): number {
  return g[stat];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Career mean for a stat — stable baseline for factor ratios. */
function careerMean(log: PlayerGameLogEntry[], stat: StatType): number {
  return mean(log.map((g) => statValue(g, stat)));
}

/** Mean of the stat in `season`, falling back to most recent season / career. */
function seasonAverage(
  log: PlayerGameLogEntry[],
  season: number,
  stat: StatType,
): number {
  const thisSeason = log.filter((g) => g.season === season);
  if (thisSeason.length >= 3) return mean(thisSeason.map((g) => statValue(g, stat)));

  // Thin current season: blend with the previous season for stability.
  const prevSeason = log.filter((g) => g.season === season - 1);
  const blendPool = [...thisSeason, ...prevSeason];
  if (blendPool.length >= 3) return mean(blendPool.map((g) => statValue(g, stat)));

  return careerMean(log, stat);
}

/** Most-recent-first stat values across season boundaries. */
function recentForm(log: PlayerGameLogEntry[], stat: StatType, window: number): number[] {
  // Log is chronological (oldest first); take the tail and reverse.
  return log
    .slice(-window)
    .reverse()
    .map((g) => statValue(g, stat));
}

/** Shrink a raw ratio toward 1.0 based on sample size n. */
function shrinkRatio(rawRatio: number, n: number): number {
  if (n <= 0 || !Number.isFinite(rawRatio) || rawRatio <= 0) return 1;
  const weight = n / (n + SHRINK_K);
  return 1 + (rawRatio - 1) * weight;
}

function opponentFactor(
  log: PlayerGameLogEntry[],
  opponent: string | null,
  stat: StatType,
): number {
  if (!opponent) return 1;
  const base = careerMean(log, stat);
  if (base <= 0) return 1;
  const vs = log.filter((g) => g.opponent === opponent).map((g) => statValue(g, stat));
  if (vs.length === 0) return 1;
  return shrinkRatio(mean(vs) / base, vs.length);
}

function venueFactor(
  history: PlayerHistory,
  venue: string | null,
  stat: StatType,
): number {
  if (!venue) return 1;
  const base = careerMean(history.gameLog, stat);
  if (base <= 0) return 1;
  const split = history.venueSplits.find((v) => v.venue === venue);
  if (!split) return 1;
  const venueAvg = {
    disposals: split.avgDisposals,
    marks: split.avgMarks,
    tackles: split.avgTackles,
    goals: split.avgGoals,
  }[stat];
  if (!venueAvg || venueAvg <= 0) return 1;
  return shrinkRatio(venueAvg / base, split.games);
}

export interface FeatureContext {
  season: number;
  opponent: string | null; // canonical team name of the upcoming opponent
  venue: string | null; // canonical venue of the upcoming game
  formWindow: number;
  teamFactors?: Record<StatType, number> | null; // team matchup factor per stat, see teamMatchup.ts
  playerFactors?: Record<StatType, number> | null; // per-player calibration factor per stat, see calibration.ts
}

/** Build one PredictionInput per stat for a player's upcoming game. */
export function buildInputs(
  history: PlayerHistory,
  ctx: FeatureContext,
): PredictionInput[] {
  const log = history.gameLog;
  if (log.length === 0) return [];

  return STAT_TYPES.map((stat) => ({
    statType: stat,
    seasonAverage: seasonAverage(log, ctx.season, stat),
    recentForm: recentForm(log, stat, ctx.formWindow),
    opponentFactor: opponentFactor(log, ctx.opponent, stat),
    venueFactor: venueFactor(history, ctx.venue, stat),
    teamFactor: ctx.teamFactors?.[stat] ?? 1,
    playerFactor: ctx.playerFactors?.[stat] ?? 1,
  }));
}

export interface StatFeature {
  statType: StatType;
  seasonAverage: number;
  /** Most-recent-first stat values, up to `window` games (for charts + hit rate). */
  recentForm: number[];
  /** Player's average for this stat vs the upcoming opponent (null if never met). */
  vsOpponentAvg: number | null;
  /** How many career games that average is based on. */
  vsOpponentGames: number;
}

/** Player's record for a stat against a specific opponent (career). */
function vsOpponentRecord(
  log: PlayerGameLogEntry[],
  opponent: string | null,
  stat: StatType,
): { avg: number | null; games: number } {
  if (!opponent) return { avg: null, games: 0 };
  const vals = log
    .filter((g) => g.opponent === opponent)
    .map((g) => statValue(g, stat));
  if (vals.length === 0) return { avg: null, games: 0 };
  return { avg: mean(vals), games: vals.length };
}

/** Season average + recent form + vs-opponent record per stat, for persistence + display. */
export function buildStatFeatures(
  history: PlayerHistory,
  season: number,
  opponent: string | null = null,
  window = 10,
): StatFeature[] {
  const log = history.gameLog;
  return STAT_TYPES.map((stat) => {
    const vs = vsOpponentRecord(log, opponent, stat);
    return {
      statType: stat,
      seasonAverage: seasonAverage(log, season, stat),
      recentForm: recentForm(log, stat, window),
      vsOpponentAvg: vs.avg,
      vsOpponentGames: vs.games,
    };
  });
}

/**
 * Actual stat values for a completed game.
 * Prefer season+round+opponent; fall back to season+opponent when Squiggle and
 * AFL Tables round numbers diverge (common after Opening Round / bye weeks).
 */
export function actualForGame(
  log: PlayerGameLogEntry[],
  season: number,
  round: string,
  opponent: string | null,
): Record<StatType, number> | null {
  const seasonLog = log.filter((g) => g.season === season);
  let entry =
    seasonLog.find(
      (g) =>
        String(g.round) === String(round) &&
        (opponent ? g.opponent === opponent : true),
    ) ?? null;

  // Squiggle R19 vs AFL Tables R20 (same opponent) — trust opponent + season.
  if (!entry && opponent) {
    const vsOpp = seasonLog.filter((g) => g.opponent === opponent);
    if (vsOpp.length > 0) entry = vsOpp[vsOpp.length - 1]!;
  }

  if (!entry) return null;
  return {
    disposals: entry.disposals,
    marks: entry.marks,
    tackles: entry.tackles,
    goals: entry.goals,
  };
}
