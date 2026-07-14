import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { backtestRuns, backtestSlips } from "@/db/schema";
import { BACKTEST_STRATEGIES } from "@/lib/backtest/matrix";

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
}

function strategyLabel(key: string): string {
  return BACKTEST_STRATEGIES.find((s) => s.key === key)?.label ?? key;
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

  return rows
    .filter((r) => r.slipsWritten > 0)
    .map(toRunOption)
    .sort((a, b) => {
      // Weekly lab first, then fuller runs (more slips), then newer.
      const aWeekly = a.label.startsWith("strategy-lab-") ? 0 : 1;
      const bWeekly = b.label.startsWith("strategy-lab-") ? 0 : 1;
      if (aWeekly !== bWeekly) return aWeekly - bWeekly;
      if (b.slipsWritten !== a.slipsWritten) return b.slipsWritten - a.slipsWritten;
      return b.id - a.id;
    });
}

function pickDefaultRunId(runs: BacktestRunOption[]): number | null {
  if (runs.length === 0) return null;
  const weekly = runs.find((r) => r.label.startsWith("strategy-lab-"));
  if (weekly) return weekly.id;
  return runs[0]!.id;
}

async function aggregateRun(runId: number): Promise<{
  strategies: StrategySummary[];
  bySeason: SeasonBreakdown[];
  calibration: CalibrationBin[];
}> {
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
    .where(eq(backtestSlips.runId, runId))
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
    .where(eq(backtestSlips.runId, runId))
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
      and(eq(backtestSlips.runId, runId), sql`${backtestSlips.modelledChance} is not null`),
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

/**
 * Strategy lab aggregates for Review.
 * @param runId optional — when omitted, prefer weekly `strategy-lab-*`, else fullest run.
 */
export async function getBacktestLabData(runId?: number): Promise<BacktestLabData> {
  const runs = await listBacktestRuns();
  const empty: BacktestLabData = {
    run: null,
    runs,
    strategies: [],
    bySeason: [],
    calibration: [],
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

  const { strategies, bySeason, calibration } = await aggregateRun(run.id);

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
  };
}
