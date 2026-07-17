import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  backtestRuns,
  backtestSlips,
  systemPolicy,
  type SystemPolicyDefaults,
  type SystemPolicyWeights,
  type SystemStrategyWeight,
} from "@/db/schema";
import { BACKTEST_STRATEGIES } from "@/lib/backtest/matrix";
import { listBacktestRuns } from "@/lib/data/backtest";

const MIN_N = 50;
const PORTFOLIO_K = 8;

export { PORTFOLIO_K };

function tanh(x: number): number {
  const e2 = Math.exp(2 * x);
  return (e2 - 1) / (e2 + 1);
}

/** score = 0.65 * slipHitRate + 0.35 * tanh(flatRoi), down-weighted if N < min. */
export function scoreStrategy(
  slipHitRate: number | null,
  flatRoi: number | null,
  slips: number,
): number {
  const hit = slipHitRate ?? 0;
  const roi = flatRoi ?? 0;
  let score = 0.65 * hit + 0.35 * tanh(roi);
  if (slips < MIN_N) {
    score *= Math.max(0.15, slips / MIN_N);
  }
  return score;
}

function pickSourceRunId(preferredRunId?: number): Promise<number | null> {
  return (async () => {
    if (preferredRunId != null) {
      const [row] = await db
        .select({ id: backtestRuns.id, slips: backtestRuns.slipsWritten })
        .from(backtestRuns)
        .where(eq(backtestRuns.id, preferredRunId))
        .limit(1);
      if (row && row.slips > 0) return row.id;
    }
    const runs = await listBacktestRuns(30);
    if (runs.length === 0) return null;
    // Prefer fullest multi-season production run, then weekly lab.
    // Never auto-pick exp-* / smoke-* experiment labels into live helm.
    const full = runs
      .filter((r) => {
        const label = r.label ?? "";
        if (label.startsWith("exp-") || label.startsWith("smoke-")) return false;
        return label.startsWith("full-") || (r.seasons?.length ?? 0) >= 2;
      })
      .sort((a, b) => b.slipsWritten - a.slipsWritten)[0];
    if (full) return full.id;
    const weekly = runs.find((r) => r.label.startsWith("strategy-lab-"));
    if (weekly) return weekly.id;
    const safe = runs.find((r) => {
      const label = r.label ?? "";
      return !label.startsWith("exp-") && !label.startsWith("smoke-") && r.slipsWritten > 0;
    });
    return safe?.id ?? null;
  })();
}

export interface ActivePolicyView {
  id: number;
  sourceRunId: number | null;
  sourceLabel: string | null;
  /** Seasons included in the source lab run (e.g. 2024–2026 YTD). */
  sourceSeasons: number[];
  defaults: SystemPolicyDefaults;
  weights: SystemPolicyWeights;
  rationale: string | null;
  updatedAt: Date;
  portfolioKeys: string[];
}

function seasonsPhrase(seasons: number[]): string {
  if (seasons.length === 0) return "available seasons";
  if (seasons.length === 1) return String(seasons[0]);
  return `${seasons[0]}–${seasons[seasons.length - 1]}`;
}

/** Derive strategy weights from a backtest run and persist as the active policy. */
export async function refreshPolicy(opts?: {
  runId?: number;
}): Promise<ActivePolicyView> {
  const sourceRunId = await pickSourceRunId(opts?.runId);
  if (sourceRunId == null) {
    throw new Error("No backtest run with slips — run Strategy lab first.");
  }

  const [run] = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.id, sourceRunId))
    .limit(1);

  const rows = await db
    .select({
      strategyKey: backtestSlips.strategyKey,
      focus: backtestSlips.focus,
      legCount: backtestSlips.legCount,
      slips: sql<number>`count(*)::int`,
      slipHits: sql<number>`sum(case when ${backtestSlips.slipHit} then 1 else 0 end)::int`,
      flatReturned: sql<number>`sum(${backtestSlips.flatReturn})`,
    })
    .from(backtestSlips)
    .where(eq(backtestSlips.runId, sourceRunId))
    .groupBy(
      backtestSlips.strategyKey,
      backtestSlips.focus,
      backtestSlips.legCount,
    );

  const byKey = new Map(
    rows.map((r) => {
      const slips = Number(r.slips);
      const slipHits = Number(r.slipHits);
      const flatReturned = Number(r.flatReturned);
      const slipHitRate = slips > 0 ? slipHits / slips : null;
      const flatRoi = slips > 0 ? (flatReturned - slips) / slips : null;
      return [
        r.strategyKey,
        {
          strategyKey: r.strategyKey,
          focus: r.focus,
          legCount: r.legCount,
          slips,
          slipHitRate,
          flatRoi,
          score: scoreStrategy(slipHitRate, flatRoi, slips),
        },
      ] as const;
    }),
  );

  // Ensure every matrix strategy appears (score 0 if never seen).
  const strategies: SystemStrategyWeight[] = BACKTEST_STRATEGIES.map((s) => {
    const hit = byKey.get(s.key);
    const slips = hit?.slips ?? 0;
    const slipHitRate = hit?.slipHitRate ?? null;
    const flatRoi = hit?.flatRoi ?? null;
    return {
      strategyKey: s.key,
      focus: s.focus,
      legCount: s.legCount,
      label: s.label,
      score: hit?.score ?? 0,
      rank: 0,
      tier: "low" as const,
      slipHitRate,
      flatRoi,
      slips,
    };
  }).sort((a, b) => b.score - a.score || b.slips - a.slips);

  strategies.forEach((s, i) => {
    s.rank = i + 1;
    s.tier = i < 3 ? "banker" : i < 8 ? "balanced" : "low";
  });

  const top = strategies[0]!;
  const defaults: SystemPolicyDefaults = {
    focus: top.focus,
    legCount: top.legCount,
  };

  const seasons = (run?.seasons ?? []) as number[];
  const pct = (n: number | null) =>
    n == null ? "—" : `${Math.round(n * 1000) / 10}%`;
  const rationale = `Lab run #${sourceRunId} · seasons ${seasonsPhrase(seasons)} (games in DB through now). Favours ${top.label} (slip hit ${pct(top.slipHitRate)}, flat ROI ${pct(top.flatRoi)}, n=${top.slips}). Baseline only — each game's System book blends this with Lab H2H + FUN flutter.`;

  const weights: SystemPolicyWeights = { strategies };

  // Deactivate previous active rows, insert new active policy.
  await db.update(systemPolicy).set({ active: false });
  const [inserted] = await db
    .insert(systemPolicy)
    .values({
      active: true,
      sourceRunId,
      weights,
      defaults,
      rationale,
      updatedAt: new Date(),
    })
    .returning();

  return toView(inserted!, run?.label ?? null, seasons);
}

function toView(
  row: typeof systemPolicy.$inferSelect,
  sourceLabel: string | null,
  sourceSeasons: number[] = [],
): ActivePolicyView {
  const strategies = row.weights?.strategies ?? [];
  const portfolioKeys = strategies
    .filter((s) => s.tier === "banker" || s.tier === "balanced")
    .slice(0, PORTFOLIO_K)
    .map((s) => s.strategyKey);

  return {
    id: row.id,
    sourceRunId: row.sourceRunId,
    sourceLabel,
    sourceSeasons,
    defaults: row.defaults,
    weights: row.weights,
    rationale: row.rationale,
    updatedAt: row.updatedAt,
    portfolioKeys,
  };
}

/** Active policy, or null if none refreshed yet. */
export async function getActivePolicy(): Promise<ActivePolicyView | null> {
  const [row] = await db
    .select()
    .from(systemPolicy)
    .where(eq(systemPolicy.active, true))
    .orderBy(desc(systemPolicy.updatedAt))
    .limit(1);
  if (!row) return null;

  let sourceLabel: string | null = null;
  let sourceSeasons: number[] = [];
  if (row.sourceRunId != null) {
    const [run] = await db
      .select({ label: backtestRuns.label, seasons: backtestRuns.seasons })
      .from(backtestRuns)
      .where(eq(backtestRuns.id, row.sourceRunId))
      .limit(1);
    sourceLabel = run?.label ?? null;
    sourceSeasons = (run?.seasons ?? []) as number[];
  }
  return toView(row, sourceLabel, sourceSeasons);
}

/** Ensure a policy exists — refresh from best lab run if missing. */
export async function ensureActivePolicy(): Promise<ActivePolicyView> {
  const existing = await getActivePolicy();
  if (existing) return existing;
  return refreshPolicy();
}
