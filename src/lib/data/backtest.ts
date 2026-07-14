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
  strategies: StrategySummary[];
  bySeason: SeasonBreakdown[];
  calibration: CalibrationBin[];
}

function strategyLabel(key: string): string {
  return BACKTEST_STRATEGIES.find((s) => s.key === key)?.label ?? key;
}

/** Latest completed (or latest any) backtest run + aggregates for charts. */
export async function getBacktestLabData(): Promise<BacktestLabData> {
  const runs = await db
    .select()
    .from(backtestRuns)
    .orderBy(desc(backtestRuns.startedAt))
    .limit(5);

  const run =
    runs.find((r) => r.status === "complete") ?? runs[0] ?? null;

  if (!run) {
    return { run: null, strategies: [], bySeason: [], calibration: [] };
  }

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
    .where(eq(backtestSlips.runId, run.id))
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
      // Weighted avg chance approx: leave as latest-ish; recompute from all slips below if needed
    }
  }

  // Recalculate avg modelled chance properly per strategy
  const chanceRows = await db
    .select({
      strategyKey: backtestSlips.strategyKey,
      avgChance: sql<number>`avg(${backtestSlips.modelledChance})`,
    })
    .from(backtestSlips)
    .where(eq(backtestSlips.runId, run.id))
    .groupBy(backtestSlips.strategyKey);
  for (const c of chanceRows) {
    const s = byKey.get(c.strategyKey);
    if (s) s.avgModelledChance = c.avgChance != null ? Number(c.avgChance) : null;
  }

  const strategies = [...byKey.values()].sort(
    (a, b) => (b.slipHitRate ?? -1) - (a.slipHitRate ?? -1) || b.slips - a.slips,
  );

  // Calibration: bin slips by modelled chance
  const calRaw = await db
    .select({
      bin: sql<number>`floor(coalesce(${backtestSlips.modelledChance}, 0) * 10)`,
      slips: sql<number>`count(*)::int`,
      hits: sql<number>`sum(case when ${backtestSlips.slipHit} then 1 else 0 end)::int`,
    })
    .from(backtestSlips)
    .where(
      and(eq(backtestSlips.runId, run.id), sql`${backtestSlips.modelledChance} is not null`),
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
    strategies,
    bySeason,
    calibration,
  };
}
