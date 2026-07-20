import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { StatType } from "@/db/schema";

import { db } from "@/db";
import {
  games,
  lineupPlayers,
  playerGameFeatures,
  playerGameStats,
  players,
} from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { getPlayerHistory } from "@/lib/ingest/aflTables";

/** Markets we rank on the Stats Leaders board. */
export const LEADER_METRICS = [
  "disposals",
  "kicks",
  "handballs",
  "marks",
  "tackles",
  "goals",
] as const;

export type LeaderMetric = (typeof LEADER_METRICS)[number];

export type PositionBucket =
  | "KEYF"
  | "FWD"
  | "MID"
  | "RUC"
  | "DEF"
  | "KEYD"
  | "UNK";

export type BenchmarkBand = "elite" | "above" | "average" | "below";

export type LeaderRow = {
  rank: number;
  playerId: number;
  playerName: string;
  team: string | null;
  position: PositionBucket;
  positionRaw: string | null;
  metric: LeaderMetric;
  average: number;
  games: number;
  band: BenchmarkBand;
  /** Percentile within position cohort (0–100). */
  percentile: number;
};

export type LeadersQuery = {
  season: number;
  metric: LeaderMetric;
  team?: string | null;
  /** Second club for H2H shortlist (OR filter). */
  teamB?: string | null;
  position?: PositionBucket | "ALL" | null;
  limit?: number;
  /** Only Elite / Above / Average (skip Below). */
  bettableOnly?: boolean;
};

const FEATURE_STATS = new Set(["disposals", "marks", "tackles", "goals"]);

/** Map free-text lineup positions → coarse buckets for benchmarking. */
export function bucketPosition(raw: string | null | undefined): PositionBucket {
  if (!raw) return "UNK";
  const p = raw.toLowerCase();
  if (
    p.includes("key forward") ||
    p.includes("full forward") ||
    p.includes("centre half-forward") ||
    p.includes("center half-forward") ||
    /\bkeyf\b/.test(p)
  ) {
    return "KEYF";
  }
  if (
    p.includes("key defender") ||
    p.includes("full back") ||
    p.includes("centre half-back") ||
    p.includes("center half-back") ||
    /\bkeyd\b/.test(p)
  ) {
    return "KEYD";
  }
  if (p.includes("ruck") || p.includes("follower") || /\bruc\b/.test(p)) {
    return "RUC";
  }
  if (
    p.includes("mid") ||
    p.includes("wing") ||
    p.includes("rover") ||
    p.includes("ruck-rover") ||
    p.includes("centre") ||
    p.includes("center")
  ) {
    return "MID";
  }
  if (
    p.includes("forward") ||
    p.includes("half-forward") ||
    p.includes("pocket")
  ) {
    return "FWD";
  }
  if (
    p.includes("back") ||
    p.includes("defender") ||
    p.includes("half-back")
  ) {
    return "DEF";
  }
  return "UNK";
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentileRank(sortedAsc: number[], value: number): number {
  if (sortedAsc.length === 0) return 50;
  let below = 0;
  for (const v of sortedAsc) {
    if (v < value) below++;
    else break;
  }
  return Math.round((below / sortedAsc.length) * 1000) / 10;
}

function bandFromPercentile(p: number): BenchmarkBand {
  if (p >= 90) return "elite";
  if (p >= 70) return "above";
  if (p >= 30) return "average";
  return "below";
}

async function latestPositions(): Promise<Map<number, string>> {
  const rows = await db
    .select({
      playerId: lineupPlayers.playerId,
      position: lineupPlayers.position,
      gameId: lineupPlayers.gameId,
    })
    .from(lineupPlayers)
    .where(sql`${lineupPlayers.playerId} is not null`);

  const best = new Map<number, { gameId: number; position: string | null }>();
  for (const r of rows) {
    if (r.playerId == null) continue;
    const prev = best.get(r.playerId);
    if (!prev || r.gameId > prev.gameId) {
      best.set(r.playerId, { gameId: r.gameId, position: r.position });
    }
  }
  const out = new Map<number, string>();
  for (const [id, v] of best) {
    if (v.position) out.set(id, v.position);
  }
  return out;
}

type BaseRow = {
  playerId: number;
  playerName: string;
  team: string | null;
  average: number;
  games: number;
};

/** Season averages from settled player_game_stats (D/M/T/G) — current after settle. */
async function leadersFromPlayerGameStats(
  season: number,
  metric: LeaderMetric,
  teamFilter: string[],
): Promise<BaseRow[]> {
  if (!FEATURE_STATS.has(metric)) return [];

  const col =
    metric === "disposals"
      ? playerGameStats.disposals
      : metric === "marks"
        ? playerGameStats.marks
        : metric === "tackles"
          ? playerGameStats.tackles
          : playerGameStats.goals;

  const filters = [
    eq(games.season, season),
    eq(playerGameStats.settled, true),
    eq(playerGameStats.didPlay, true),
    sql`${col} is not null`,
  ];
  if (teamFilter.length > 0) {
    filters.push(inArray(players.team, teamFilter));
  }

  const rows = await db
    .select({
      playerId: playerGameStats.playerId,
      name: players.name,
      team: players.team,
      average: sql<number>`avg(${col})::float`,
      games: sql<number>`count(*)::int`,
    })
    .from(playerGameStats)
    .innerJoin(players, eq(players.id, playerGameStats.playerId))
    .innerJoin(games, eq(games.id, playerGameStats.gameId))
    .where(and(...filters))
    .groupBy(playerGameStats.playerId, players.name, players.team);

  return rows
    .filter((r) => r.average != null && Number.isFinite(r.average) && r.average > 0)
    .map((r) => ({
      playerId: r.playerId,
      playerName: r.name,
      team: r.team,
      average: Math.round(r.average * 10) / 10,
      games: r.games,
    }));
}

/** Fallback: season averages from prediction features (D/M/T/G) at predict time. */
async function leadersFromFeatures(
  season: number,
  metric: LeaderMetric,
  teamFilter: string[],
): Promise<BaseRow[]> {
  if (!FEATURE_STATS.has(metric)) return [];

  const filters = [
    eq(games.season, season),
    eq(playerGameFeatures.statType, metric as StatType),
  ];
  if (teamFilter.length > 0) {
    filters.push(inArray(players.team, teamFilter));
  }

  const rows = await db
    .select({
      playerId: playerGameFeatures.playerId,
      name: players.name,
      team: players.team,
      seasonAverage: playerGameFeatures.seasonAverage,
      recentForm: playerGameFeatures.recentForm,
      commenceTime: games.commenceTime,
      gameId: playerGameFeatures.gameId,
    })
    .from(playerGameFeatures)
    .innerJoin(players, eq(players.id, playerGameFeatures.playerId))
    .innerJoin(games, eq(games.id, playerGameFeatures.gameId))
    .where(and(...filters))
    .orderBy(desc(games.commenceTime), desc(playerGameFeatures.gameId));

  const best = new Map<number, BaseRow>();
  for (const r of rows) {
    if (best.has(r.playerId)) continue;
    const avg = r.seasonAverage;
    if (avg == null || !Number.isFinite(avg) || avg <= 0) continue;
    const form = Array.isArray(r.recentForm) ? r.recentForm.length : 0;
    best.set(r.playerId, {
      playerId: r.playerId,
      playerName: r.name,
      team: r.team,
      average: avg,
      games: form,
    });
  }
  return [...best.values()];
}

/**
 * Kicks / handballs (and fallback) from AFL Tables career pages — cached.
 */
async function leadersFromHistory(
  season: number,
  metric: LeaderMetric,
  teamFilter: string[],
  limitFetch = 80,
): Promise<BaseRow[]> {
  const roster =
    teamFilter.length > 0
      ? await db
          .select({
            id: players.id,
            name: players.name,
            team: players.team,
            slug: players.aflTablesSlug,
          })
          .from(players)
          .where(inArray(players.team, teamFilter))
          .limit(80)
      : await db
          .select({
            id: players.id,
            name: players.name,
            team: players.team,
            slug: players.aflTablesSlug,
          })
          .from(players)
          .limit(limitFetch);

  const out: BaseRow[] = [];
  const chunk = 6;
  for (let i = 0; i < roster.length; i += chunk) {
    const slice = roster.slice(i, i + chunk);
    const parts = await Promise.all(
      slice.map(async (p) => {
        try {
          const hist = await getPlayerHistory(p.name, p.slug);
          const seasonGames = hist.gameLog.filter((g) => g.season === season);
          const pool =
            seasonGames.length >= 3
              ? seasonGames
              : hist.gameLog.filter(
                  (g) => g.season === season || g.season === season - 1,
                );
          if (pool.length === 0) return null;
          const values = pool.map((g) => {
            if (metric === "kicks") return g.kicks ?? 0;
            if (metric === "handballs") return g.handballs ?? 0;
            if (metric === "disposals") return g.disposals;
            if (metric === "marks") return g.marks;
            if (metric === "tackles") return g.tackles;
            if (metric === "goals") return g.goals;
            return 0;
          });
          const avg = mean(values);
          if (avg <= 0) return null;
          return {
            playerId: p.id,
            playerName: p.name,
            team: p.team,
            average: Math.round(avg * 10) / 10,
            games: pool.length,
          } satisfies BaseRow;
        } catch {
          return null;
        }
      }),
    );
    for (const row of parts) {
      if (row) out.push(row);
    }
  }
  return out;
}

function applyBenchmark(
  rows: BaseRow[],
  positions: Map<number, string>,
  metric: LeaderMetric,
  positionFilter: PositionBucket | "ALL" | null | undefined,
  bettableOnly: boolean,
  limit: number,
): LeaderRow[] {
  const enriched = rows.map((r) => {
    const raw = positions.get(r.playerId) ?? null;
    return {
      ...r,
      positionRaw: raw,
      position: bucketPosition(raw),
    };
  });

  const filtered =
    positionFilter && positionFilter !== "ALL"
      ? enriched.filter((r) => r.position === positionFilter)
      : enriched;

  const byPos = new Map<PositionBucket, number[]>();
  for (const r of filtered) {
    const key = r.position === "UNK" ? "MID" : r.position;
    const list = byPos.get(key) ?? [];
    list.push(r.average);
    byPos.set(key, list);
  }
  for (const [, list] of byPos) list.sort((a, b) => a - b);

  const ranked = filtered
    .map((r) => {
      const key = r.position === "UNK" ? "MID" : r.position;
      const cohort = byPos.get(key) ?? [r.average];
      const percentile = percentileRank(cohort, r.average);
      const band = bandFromPercentile(percentile);
      return { ...r, percentile, band };
    })
    .filter((r) =>
      bettableOnly
        ? r.band === "elite" || r.band === "above" || r.band === "average"
        : true,
    )
    .sort((a, b) => b.average - a.average)
    .slice(0, limit);

  return ranked.map((r, i) => ({
    rank: i + 1,
    playerId: r.playerId,
    playerName: r.playerName,
    team: r.team,
    position: r.position,
    positionRaw: r.positionRaw,
    metric,
    average: Math.round(r.average * 10) / 10,
    games: r.games,
    band: r.band,
    percentile: r.percentile,
  }));
}

/**
 * Season leaders with position-relative Elite / Above / Average / Below bands.
 */
export async function getStatLeaders(
  query: LeadersQuery,
): Promise<LeaderRow[]> {
  const metric = query.metric;
  const limit = query.limit ?? 40;
  const teams: string[] = [];
  if (query.team) {
    const t = canonicalTeam(query.team) ?? query.team;
    teams.push(t);
  }
  if (query.teamB) {
    const t = canonicalTeam(query.teamB) ?? query.teamB;
    if (!teams.includes(t)) teams.push(t);
  }

  const positions = await latestPositions();

  let base: BaseRow[];
  if (FEATURE_STATS.has(metric)) {
    // Prefer settled actuals so Leaders (and System bands) update with settle.
    base = await leadersFromPlayerGameStats(query.season, metric, teams);
    if (base.length < (teams.length > 0 ? 5 : 10)) {
      base = await leadersFromFeatures(query.season, metric, teams);
    }
    if (base.length < (teams.length > 0 ? 5 : 10)) {
      base = await leadersFromHistory(query.season, metric, teams, 120);
    }
  } else {
    base = await leadersFromHistory(query.season, metric, teams, 100);
  }

  return applyBenchmark(
    base,
    positions,
    metric,
    query.position,
    query.bettableOnly ?? false,
    limit,
  );
}

/** Shortlist for a fixture: Elite→Average in a market for both clubs. */
export async function getMatchupShortlist(opts: {
  season: number;
  metric: LeaderMetric;
  teamA: string;
  teamB: string;
  limit?: number;
}): Promise<LeaderRow[]> {
  return getStatLeaders({
    season: opts.season,
    metric: opts.metric,
    team: opts.teamA,
    teamB: opts.teamB,
    bettableOnly: true,
    limit: opts.limit ?? 20,
  });
}

/** Key: `${playerId}:${statType}` → band for System book / suggest ranking. */
export type GameBenchmarkMap = Map<string, BenchmarkBand>;

/** Rich Leaders row for System book UI stamps. */
export type PlayerStatBenchmark = {
  band: BenchmarkBand;
  average: number;
  percentile: number;
  position: PositionBucket;
  positionRaw: string | null;
  team: string | null;
  playerName: string;
};

export type GameBenchmarkDetailMap = Map<string, PlayerStatBenchmark>;

const HELM_METRICS: LeaderMetric[] = [
  "disposals",
  "marks",
  "tackles",
  "goals",
];

/**
 * Load Elite→Below bands (+ avg / pos) for both clubs in a fixture.
 * Used to steer System book picks and stamp legs in the UI.
 */
export async function getGameBenchmarkBands(
  gameId: number,
): Promise<{
  bands: GameBenchmarkMap;
  details: GameBenchmarkDetailMap;
  home: string;
  away: string;
  season: number;
}> {
  const [game] = await db
    .select({
      home: games.home,
      away: games.away,
      season: games.season,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);

  if (!game) {
    return {
      bands: new Map(),
      details: new Map(),
      home: "",
      away: "",
      season: 0,
    };
  }

  const season = game.season ?? new Date().getUTCFullYear();
  const bands: GameBenchmarkMap = new Map();
  const details: GameBenchmarkDetailMap = new Map();

  await Promise.all(
    HELM_METRICS.map(async (metric) => {
      const rows = await getStatLeaders({
        season,
        metric,
        team: game.home,
        teamB: game.away,
        bettableOnly: false,
        limit: 80,
      });
      for (const r of rows) {
        const key = `${r.playerId}:${metric}`;
        bands.set(key, r.band);
        details.set(key, {
          band: r.band,
          average: r.average,
          percentile: r.percentile,
          position: r.position,
          positionRaw: r.positionRaw,
          team: r.team,
          playerName: r.playerName,
        });
      }
    }),
  );

  return {
    bands,
    details,
    home: game.home,
    away: game.away,
    season,
  };
}

export function bandRank(band: BenchmarkBand | "unknown"): number {
  switch (band) {
    case "elite":
      return 0;
    case "above":
      return 1;
    case "average":
      return 2;
    case "below":
      return 3;
    default:
      return 4;
  }
}

/** Confidence multiplier — prefer Elite/Above, soft-demote Below. */
export function bandConfidenceMult(band: BenchmarkBand | "unknown"): number {
  switch (band) {
    case "elite":
      return 1.14;
    case "above":
      return 1.07;
    case "average":
      return 1.0;
    case "below":
      return 0.52;
    default:
      return 0.9;
  }
}

export function isBettableBand(band: BenchmarkBand | "unknown"): boolean {
  return band === "elite" || band === "above" || band === "average";
}
