import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  backtestLegs,
  backtestRuns,
  backtestSlips,
  games,
} from "@/db/schema";
import { BACKTEST_STRATEGIES } from "@/lib/backtest/matrix";
import { canonicalTeam } from "@/lib/afl/teams";
import { canonicalVenue } from "@/lib/afl/venues";

/** Lab / H2H history starts Opening Round 2024 — nothing earlier. */
export const HISTORY_MIN_SEASON = 2024;

/** Scope lab aggregates to one club's games, or an exact H2H matchup. */
export interface LabGameScope {
  team?: string;
  teamA?: string;
  teamB?: string;
}

export interface StrategySummary {
  strategyKey: string;
  label: string;
  focus: string;
  legCount: number;
  slips: number;
  slipHits: number;
  slipHitRate: number | null;
  legHits: number;
  legTotal: number;
  legHitRate: number | null;
  avgModelledChance: number | null;
  flatStaked: number;
  flatReturned: number;
  flatRoi: number | null;
}

export interface SeasonBreakdown {
  season: number;
  strategyKey: string;
  slips: number;
  slipHits: number;
  slipHitRate: number | null;
  flatRoi: number | null;
}

export interface CalibrationBin {
  /** Midpoint of modelled-chance bin (0–1). */
  modelled: number;
  slips: number;
  actualHitRate: number | null;
}

export interface BacktestRunOption {
  id: number;
  label: string;
  seasons: number[];
  status: string;
  gamesProcessed: number;
  slipsWritten: number;
  startedAt: Date;
}

export type BacktestRunKind =
  | "weekly"
  | "full"
  | "experiment"
  | "smoke"
  | "other";

/** Human-friendly title for a run label (dropdown / Lab header). */
export function describeBacktestRun(r: {
  id: number;
  label: string;
  seasons?: number[] | null;
  slipsWritten?: number;
  status?: string;
}): {
  kind: BacktestRunKind;
  title: string;
  seasonsText: string;
  optionLabel: string;
} {
  const label = r.label ?? "";
  const seasons = r.seasons ?? [];
  const seasonsText =
    seasons.length === 0
      ? "?"
      : seasons.length === 1
        ? String(seasons[0])
        : `${seasons[0]}–${seasons[seasons.length - 1]}`;

  let kind: BacktestRunKind = "other";
  let title = label;

  if (label.startsWith("strategy-lab-")) {
    kind = "weekly";
    title = "Weekly lab";
  } else if (label.startsWith("full-")) {
    kind = "full";
    title = "Full history";
  } else if (label.startsWith("smoke")) {
    kind = "smoke";
    title = label === "smoke" ? "Smoke test" : `Smoke · ${label.replace(/^smoke-?/, "") || "test"}`;
  } else if (label.startsWith("exp-")) {
    kind = "experiment";
    if (label.includes("wide") && label.includes("spread")) {
      title = "Experiment · wide + spread";
    } else if (label.includes("wide") && label.includes("overlap")) {
      title = "Experiment · wide (overlap OK)";
    } else if (label.includes("wide")) {
      title = "Experiment · wide legs";
    } else {
      title = "Experiment";
    }
  }

  const slips = r.slipsWritten ?? 0;
  const slipsText = slips.toLocaleString("en-AU");
  const statusNote =
    r.status === "running"
      ? " · running…"
      : r.status === "failed"
        ? " · failed"
        : "";

  const optionLabel = `${title} · ${seasonsText} · ${slipsText} slips${statusNote} (#${r.id})`;

  return { kind, title, seasonsText, optionLabel };
}

/** Slip results if you only bet games involving this club. */
export interface TeamContextRow {
  team: string;
  games: number;
  slips: number;
  slipHits: number;
  slipHitRate: number | null;
  flatRoi: number | null;
  homeSlips: number;
  homeHits: number;
  homeRoi: number | null;
  awaySlips: number;
  awayHits: number;
  awayRoi: number | null;
}

/** Slip results at a venue (oval). */
export interface VenueContextRow {
  venue: string;
  games: number;
  slips: number;
  slipHits: number;
  slipHitRate: number | null;
  flatRoi: number | null;
}

/** Slip results for a specific fixture matchup. */
export interface MatchupContextRow {
  home: string;
  away: string;
  label: string;
  games: number;
  slips: number;
  slipHits: number;
  slipHitRate: number | null;
  flatRoi: number | null;
}

/** Leg hit rate for players from this club (not whole-slip). */
export interface PlayerTeamLegRow {
  team: string;
  legs: number;
  hits: number;
  hitRate: number | null;
}

export interface BacktestContext {
  byTeam: TeamContextRow[];
  byVenue: VenueContextRow[];
  byMatchup: MatchupContextRow[];
  byPlayerTeam: PlayerTeamLegRow[];
}

export interface BacktestLabData {
  run: {
    id: number;
    label: string;
    seasons: number[];
    status: string;
    gamesProcessed: number;
    slipsWritten: number;
    startedAt: Date;
    finishedAt: Date | null;
  } | null;
  /** Other runs available in the Strategy lab picker. */
  runs: BacktestRunOption[];
  strategies: StrategySummary[];
  bySeason: SeasonBreakdown[];
  calibration: CalibrationBin[];
  context: BacktestContext;
  /** Active game scope (null / empty = all clubs). */
  scope: LabGameScope | null;
  scopeLabel: string | null;
  scopedGames: number;
}

function emptyContext(): BacktestContext {
  return { byTeam: [], byVenue: [], byMatchup: [], byPlayerTeam: [] };
}

function rate(hits: number, n: number): number | null {
  return n > 0 ? hits / n : null;
}

function roi(returned: number, staked: number): number | null {
  return staked > 0 ? (returned - staked) / staked : null;
}

function strategyLabel(key: string): string {
  const known = BACKTEST_STRATEGIES.find((s) => s.key === key)?.label;
  if (known) return known;
  const m = key.match(/^([a-z]+)_(\d+)$/i);
  if (!m) return key;
  const focus = m[1]!;
  const legs = m[2]!;
  const focusLabel =
    focus === "any"
      ? "Any"
      : focus.charAt(0).toUpperCase() + focus.slice(1);
  return `${focusLabel} · ${legs} legs`;
}

function toRunOption(r: typeof backtestRuns.$inferSelect): BacktestRunOption {
  return {
    id: r.id,
    label: r.label,
    seasons: r.seasons ?? [],
    status: r.status,
    gamesProcessed: r.gamesProcessed,
    slipsWritten: r.slipsWritten,
    startedAt: r.startedAt,
  };
}

/** List recent runs that have slips (for the Review picker). */
export async function listBacktestRuns(limit = 20): Promise<BacktestRunOption[]> {
  const rows = await db
    .select()
    .from(backtestRuns)
    .orderBy(desc(backtestRuns.startedAt))
    .limit(limit);

  const kindRank = (label: string): number => {
    // Multi-season history first — weekly 2026 alone is too thin for H2H.
    if (label.startsWith("full-")) return 0;
    if (label.startsWith("exp-") && label.includes("wide")) return 1;
    if (label.startsWith("exp-")) return 2;
    if (label.startsWith("strategy-lab-")) return 3;
    if (label.startsWith("smoke")) return 4;
    return 5;
  };

  return rows
    .filter((r) => r.slipsWritten > 0)
    .map(toRunOption)
    .sort((a, b) => {
      const kr = kindRank(a.label) - kindRank(b.label);
      if (kr !== 0) return kr;
      if (b.slipsWritten !== a.slipsWritten) return b.slipsWritten - a.slipsWritten;
      return b.id - a.id;
    });
}

/** Prefer full multi-season history (not weekly 2026-only). */
function pickDefaultRunId(runs: BacktestRunOption[]): number | null {
  if (runs.length === 0) return null;
  const full = runs
    .filter((r) => r.label.startsWith("full-"))
    .sort((a, b) => b.slipsWritten - a.slipsWritten)[0];
  if (full) return full.id;
  const wide = runs
    .filter((r) => r.label.startsWith("exp-") && r.label.includes("wide"))
    .sort((a, b) => b.slipsWritten - a.slipsWritten)[0];
  if (wide) return wide.id;
  const multi = runs
    .filter((r) => (r.seasons?.length ?? 0) >= 2)
    .sort((a, b) => b.slipsWritten - a.slipsWritten)[0];
  if (multi) return multi.id;
  return runs[0]!.id;
}

async function resolveScopedGameIds(
  runId: number,
  scope?: LabGameScope | null,
): Promise<{ gameIds: number[] | null; label: string | null }> {
  const rows = await db
    .selectDistinct({
      gameId: backtestSlips.gameId,
      home: games.home,
      away: games.away,
      season: games.season,
    })
    .from(backtestSlips)
    .innerJoin(games, eq(games.id, backtestSlips.gameId))
    .where(
      and(
        eq(backtestSlips.runId, runId),
        gte(games.season, HISTORY_MIN_SEASON),
      ),
    );

  // No club filter: every completed game from 2024 R0 in this run.
  if (!scope?.team && !(scope?.teamA && scope?.teamB)) {
    return {
      gameIds: rows.map((r) => r.gameId),
      label: `From ${HISTORY_MIN_SEASON} R0`,
    };
  }

  if (scope.teamA && scope.teamB) {
    const a = canonicalTeam(scope.teamA) ?? scope.teamA;
    const b = canonicalTeam(scope.teamB) ?? scope.teamB;
    const ids = rows
      .filter((r) => {
        const home = canonicalTeam(r.home) ?? r.home;
        const away = canonicalTeam(r.away) ?? r.away;
        return (
          (home === a && away === b) || (home === b && away === a)
        );
      })
      .map((r) => r.gameId);
    return { gameIds: ids, label: `${a} v ${b}` };
  }

  const team = canonicalTeam(scope.team) ?? scope.team!;
  const ids = rows
    .filter((r) => {
      const home = canonicalTeam(r.home) ?? r.home;
      const away = canonicalTeam(r.away) ?? r.away;
      return home === team || away === team;
    })
    .map((r) => r.gameId);
  return { gameIds: ids, label: team };
}

async function aggregateRun(
  runId: number,
  gameIds?: number[] | null,
): Promise<{
  strategies: StrategySummary[];
  bySeason: SeasonBreakdown[];
  calibration: CalibrationBin[];
}> {
  if (gameIds != null && gameIds.length === 0) {
    return { strategies: [], bySeason: [], calibration: [] };
  }

  const scopeWhere =
    gameIds == null
      ? eq(backtestSlips.runId, runId)
      : and(
          eq(backtestSlips.runId, runId),
          inArray(backtestSlips.gameId, gameIds),
        );

  const slipRows = await db
    .select({
      strategyKey: backtestSlips.strategyKey,
      focus: backtestSlips.focus,
      legCount: backtestSlips.legCount,
      season: backtestSlips.season,
      slips: sql<number>`count(*)::int`,
      slipHits: sql<number>`sum(case when ${backtestSlips.slipHit} then 1 else 0 end)::int`,
      legHits: sql<number>`sum(${backtestSlips.legsHit})::int`,
      legTotal: sql<number>`sum(${backtestSlips.legsTotal})::int`,
      avgChance: sql<number>`avg(${backtestSlips.modelledChance})`,
      flatReturned: sql<number>`sum(${backtestSlips.flatReturn})`,
    })
    .from(backtestSlips)
    .where(scopeWhere)
    .groupBy(
      backtestSlips.strategyKey,
      backtestSlips.focus,
      backtestSlips.legCount,
      backtestSlips.season,
    );

  const byKey = new Map<string, StrategySummary>();
  const bySeason: SeasonBreakdown[] = [];

  for (const row of slipRows) {
    const slips = Number(row.slips);
    const slipHits = Number(row.slipHits);
    const flatReturned = Number(row.flatReturned);
    const flatRoi = slips > 0 ? (flatReturned - slips) / slips : null;

    bySeason.push({
      season: row.season,
      strategyKey: row.strategyKey,
      slips,
      slipHits,
      slipHitRate: slips > 0 ? slipHits / slips : null,
      flatRoi,
    });

    const prev = byKey.get(row.strategyKey);
    if (!prev) {
      byKey.set(row.strategyKey, {
        strategyKey: row.strategyKey,
        label: strategyLabel(row.strategyKey),
        focus: row.focus,
        legCount: row.legCount,
        slips,
        slipHits,
        slipHitRate: slips > 0 ? slipHits / slips : null,
        legHits: Number(row.legHits),
        legTotal: Number(row.legTotal),
        legHitRate:
          Number(row.legTotal) > 0 ? Number(row.legHits) / Number(row.legTotal) : null,
        avgModelledChance: row.avgChance != null ? Number(row.avgChance) : null,
        flatStaked: slips,
        flatReturned,
        flatRoi,
      });
    } else {
      prev.slips += slips;
      prev.slipHits += slipHits;
      prev.legHits += Number(row.legHits);
      prev.legTotal += Number(row.legTotal);
      prev.flatStaked += slips;
      prev.flatReturned += flatReturned;
      prev.slipHitRate = prev.slips > 0 ? prev.slipHits / prev.slips : null;
      prev.legHitRate = prev.legTotal > 0 ? prev.legHits / prev.legTotal : null;
      prev.flatRoi =
        prev.flatStaked > 0
          ? (prev.flatReturned - prev.flatStaked) / prev.flatStaked
          : null;
    }
  }

  const chanceRows = await db
    .select({
      strategyKey: backtestSlips.strategyKey,
      avgChance: sql<number>`avg(${backtestSlips.modelledChance})`,
    })
    .from(backtestSlips)
    .where(scopeWhere)
    .groupBy(backtestSlips.strategyKey);
  for (const c of chanceRows) {
    const s = byKey.get(c.strategyKey);
    if (s) s.avgModelledChance = c.avgChance != null ? Number(c.avgChance) : null;
  }

  const strategies = [...byKey.values()].sort(
    (a, b) => (b.slipHitRate ?? -1) - (a.slipHitRate ?? -1) || b.slips - a.slips,
  );

  const calRaw = await db
    .select({
      bin: sql<number>`floor(coalesce(${backtestSlips.modelledChance}, 0) * 10)`,
      slips: sql<number>`count(*)::int`,
      hits: sql<number>`sum(case when ${backtestSlips.slipHit} then 1 else 0 end)::int`,
    })
    .from(backtestSlips)
    .where(
      and(scopeWhere, sql`${backtestSlips.modelledChance} is not null`),
    )
    .groupBy(sql`floor(coalesce(${backtestSlips.modelledChance}, 0) * 10)`);

  const calibration: CalibrationBin[] = calRaw
    .map((r) => {
      const bin = Number(r.bin);
      const slips = Number(r.slips);
      const hits = Number(r.hits);
      return {
        modelled: (bin + 0.5) / 10,
        slips,
        actualHitRate: slips > 0 ? hits / slips : null,
      };
    })
    .sort((a, b) => a.modelled - b.modelled);

  return { strategies, bySeason, calibration };
}

/** Team / venue / H2H / player-club slices for a lab run. */
async function aggregateContext(
  runId: number,
  gameIds?: number[] | null,
): Promise<BacktestContext> {
  if (gameIds != null && gameIds.length === 0) return emptyContext();

  const scopeWhere =
    gameIds == null
      ? eq(backtestSlips.runId, runId)
      : and(
          eq(backtestSlips.runId, runId),
          inArray(backtestSlips.gameId, gameIds),
        );

  const slipRows = await db
    .select({
      gameId: backtestSlips.gameId,
      slipHit: backtestSlips.slipHit,
      flatReturn: backtestSlips.flatReturn,
      home: games.home,
      away: games.away,
      venue: games.venue,
    })
    .from(backtestSlips)
    .innerJoin(games, eq(games.id, backtestSlips.gameId))
    .where(scopeWhere);

  type Acc = {
    games: Set<number>;
    slips: number;
    hits: number;
    returned: number;
  };
  const blank = (): Acc => ({
    games: new Set(),
    slips: 0,
    hits: 0,
    returned: 0,
  });

  const teamAll = new Map<string, Acc>();
  const teamHome = new Map<string, Acc>();
  const teamAway = new Map<string, Acc>();
  const venues = new Map<string, Acc>();
  const matchups = new Map<string, Acc & { home: string; away: string }>();

  const bump = (map: Map<string, Acc>, key: string, gameId: number, hit: boolean, ret: number) => {
    let a = map.get(key);
    if (!a) {
      a = blank();
      map.set(key, a);
    }
    a.games.add(gameId);
    a.slips++;
    if (hit) a.hits++;
    a.returned += ret;
  };

  for (const r of slipRows) {
    const home = canonicalTeam(r.home) ?? r.home;
    const away = canonicalTeam(r.away) ?? r.away;
    const venue = canonicalVenue(r.venue) ?? (r.venue?.trim() || "Unknown");
    const hit = r.slipHit === true;
    const ret = Number(r.flatReturn) || 0;

    bump(teamAll, home, r.gameId, hit, ret);
    bump(teamAll, away, r.gameId, hit, ret);
    bump(teamHome, home, r.gameId, hit, ret);
    bump(teamAway, away, r.gameId, hit, ret);
    bump(venues, venue, r.gameId, hit, ret);

    const mKey = `${home}||${away}`;
    let m = matchups.get(mKey);
    if (!m) {
      m = { ...blank(), home, away };
      matchups.set(mKey, m);
    }
    m.games.add(r.gameId);
    m.slips++;
    if (hit) m.hits++;
    m.returned += ret;
  }

  const sideRoi = (map: Map<string, Acc>, team: string) => {
    const a = map.get(team);
    if (!a) return { slips: 0, hits: 0, roi: null as number | null };
    return { slips: a.slips, hits: a.hits, roi: roi(a.returned, a.slips) };
  };

  const byTeam: TeamContextRow[] = [...teamAll.entries()]
    .map(([team, a]) => {
      const home = sideRoi(teamHome, team);
      const away = sideRoi(teamAway, team);
      return {
        team,
        games: a.games.size,
        slips: a.slips,
        slipHits: a.hits,
        slipHitRate: rate(a.hits, a.slips),
        flatRoi: roi(a.returned, a.slips),
        homeSlips: home.slips,
        homeHits: home.hits,
        homeRoi: home.roi,
        awaySlips: away.slips,
        awayHits: away.hits,
        awayRoi: away.roi,
      };
    })
    .sort((a, b) => (b.flatRoi ?? -999) - (a.flatRoi ?? -999));

  const byVenue: VenueContextRow[] = [...venues.entries()]
    .map(([venue, a]) => ({
      venue,
      games: a.games.size,
      slips: a.slips,
      slipHits: a.hits,
      slipHitRate: rate(a.hits, a.slips),
      flatRoi: roi(a.returned, a.slips),
    }))
    .filter((v) => v.slips >= 10)
    .sort((a, b) => (b.flatRoi ?? -999) - (a.flatRoi ?? -999));

  const byMatchup: MatchupContextRow[] = [...matchups.values()]
    .map((m) => ({
      home: m.home,
      away: m.away,
      label: `${m.home} v ${m.away}`,
      games: m.games.size,
      slips: m.slips,
      slipHits: m.hits,
      slipHitRate: rate(m.hits, m.slips),
      flatRoi: roi(m.returned, m.slips),
    }))
    .filter((m) => m.games >= 2)
    .sort((a, b) => (b.flatRoi ?? -999) - (a.flatRoi ?? -999));

  const legRows = await db
    .select({
      team: backtestLegs.team,
      legs: sql<number>`count(*)::int`,
      hits: sql<number>`sum(case when ${backtestLegs.hit} then 1 else 0 end)::int`,
    })
    .from(backtestLegs)
    .innerJoin(backtestSlips, eq(backtestSlips.id, backtestLegs.slipId))
    .where(scopeWhere)
    .groupBy(backtestLegs.team);

  const playerAcc = new Map<string, { legs: number; hits: number }>();
  for (const r of legRows) {
    if (!r.team) continue;
    const team = canonicalTeam(r.team) ?? r.team;
    const cur = playerAcc.get(team) ?? { legs: 0, hits: 0 };
    cur.legs += Number(r.legs);
    cur.hits += Number(r.hits);
    playerAcc.set(team, cur);
  }

  const byPlayerTeam: PlayerTeamLegRow[] = [...playerAcc.entries()]
    .map(([team, a]) => ({
      team,
      legs: a.legs,
      hits: a.hits,
      hitRate: rate(a.hits, a.legs),
    }))
    .sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0));

  return { byTeam, byVenue, byMatchup, byPlayerTeam };
}

function normaliseScope(scope?: LabGameScope | null): LabGameScope | null {
  if (!scope) return null;
  if (scope.teamA && scope.teamB) {
    const a = canonicalTeam(scope.teamA) ?? scope.teamA;
    const b = canonicalTeam(scope.teamB) ?? scope.teamB;
    if (a === b) return { team: a };
    return { teamA: a, teamB: b };
  }
  if (scope.team) {
    return { team: canonicalTeam(scope.team) ?? scope.team };
  }
  return null;
}

/**
 * Strategy lab aggregates for Review / Lab.
 * @param runId optional — when omitted, prefer weekly `strategy-lab-*`, else fullest run.
 * @param scope optional — one club, or teamA+teamB for H2H legs.
 */
export async function getBacktestLabData(
  runId?: number,
  scope?: LabGameScope | null,
): Promise<BacktestLabData> {
  const runs = await listBacktestRuns();
  const empty: BacktestLabData = {
    run: null,
    runs,
    strategies: [],
    bySeason: [],
    calibration: [],
    context: emptyContext(),
    scope: null,
    scopeLabel: null,
    scopedGames: 0,
  };

  const selectedId =
    runId != null && runs.some((r) => r.id === runId)
      ? runId
      : pickDefaultRunId(runs);

  if (selectedId == null) return empty;

  const [run] = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.id, selectedId))
    .limit(1);

  if (!run) return empty;

  const normalised = normaliseScope(scope);
  const { gameIds, label } = await resolveScopedGameIds(run.id, normalised);
  // Always a concrete list from 2024 R0 (never fall back to whole-run game count).
  const scopedIds = gameIds ?? [];

  const [{ strategies, bySeason, calibration }, context] = await Promise.all([
    aggregateRun(run.id, scopedIds),
    aggregateContext(run.id, scopedIds),
  ]);

  return {
    run: {
      id: run.id,
      label: run.label,
      seasons: run.seasons ?? [],
      status: run.status,
      gamesProcessed: run.gamesProcessed,
      slipsWritten: run.slipsWritten,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    runs,
    strategies,
    bySeason,
    calibration,
    context,
    scope: normalised,
    scopeLabel: label,
    /** Distinct fixtures in scope (H2H = meetings; ALL = games since 2024 R0). */
    scopedGames: scopedIds.length,
  };
}

