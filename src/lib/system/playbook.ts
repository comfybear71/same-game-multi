import type { SystemStrategyWeight } from "@/db/schema";
import { BACKTEST_STRATEGIES } from "@/lib/backtest/matrix";
import {
  getBacktestLabData,
  listBacktestRuns,
  type StrategySummary,
} from "@/lib/data/backtest";
import {
  PORTFOLIO_K,
  scoreStrategy,
  type ActivePolicyView,
} from "@/lib/system/policy";

export type PlaybookNote = {
  strategyKey: string;
  label: string;
  focus: string;
  legCount: number;
  h2hHitRate: number | null;
  h2hRoi: number | null;
  h2hSlips: number;
  globalScore: number;
  h2hScore: number;
  combinedScore: number;
  tier: "banker" | "balanced" | "fun" | "low";
  why: string;
};

export type MatchupPlaybook = {
  teamA: string;
  teamB: string;
  meetings: number;
  sourceRunId: number | null;
  sourceLabel: string | null;
  strategies: StrategySummary[];
};

/** Prefer wide for H2H recipe depth; fall back to full / policy source. */
async function pickPlaybookRunId(
  policySourceRunId: number | null,
): Promise<{ id: number; label: string } | null> {
  const runs = await listBacktestRuns(30);
  const wide = runs.find(
    (r) => r.label.startsWith("exp-") && r.label.includes("wide") && r.slipsWritten > 0,
  );
  if (wide) return { id: wide.id, label: wide.label };
  const full = runs.find((r) => r.label.startsWith("full-") && r.slipsWritten > 0);
  if (full) return { id: full.id, label: full.label };
  if (policySourceRunId != null) {
    const hit = runs.find((r) => r.id === policySourceRunId);
    if (hit) return { id: hit.id, label: hit.label };
  }
  return runs[0] ? { id: runs[0].id, label: runs[0].label } : null;
}

export async function loadMatchupPlaybook(
  teamA: string,
  teamB: string,
  policySourceRunId: number | null,
): Promise<MatchupPlaybook | null> {
  const run = await pickPlaybookRunId(policySourceRunId);
  if (!run) return null;

  const lab = await getBacktestLabData(run.id, { teamA, teamB });
  if (lab.scopedGames <= 0) {
    return {
      teamA,
      teamB,
      meetings: 0,
      sourceRunId: run.id,
      sourceLabel: run.label,
      strategies: [],
    };
  }

  return {
    teamA,
    teamB,
    meetings: lab.scopedGames,
    sourceRunId: run.id,
    sourceLabel: lab.run?.label ?? run.label,
    strategies: lab.strategies,
  };
}

function whyNote(
  h2h: StrategySummary | undefined,
  tier: PlaybookNote["tier"],
): string {
  if (!h2h || h2h.slips < 2) return "Global helm rank (thin/no H2H sample)";
  const hit =
    h2h.slipHitRate != null
      ? `${Math.round(h2h.slipHitRate * 1000) / 10}% hit`
      : "—";
  const roi =
    h2h.flatRoi != null
      ? `${h2h.flatRoi >= 0 ? "+" : ""}${Math.round(h2h.flatRoi * 1000) / 10}% ROI`
      : "—";
  if (tier === "fun") return `H2H flutter · ${hit} · ${roi} (n=${h2h.slips})`;
  if ((h2h.slipHitRate ?? 0) >= 0.5) {
    return `H2H strong · ${hit} · ${roi} (n=${h2h.slips})`;
  }
  if ((h2h.slipHitRate ?? 0) === 0 && (h2h.flatRoi ?? 0) <= -0.99) {
    return `H2H dead · ${hit} · ${roi} (n=${h2h.slips}) — demoted`;
  }
  return `H2H blend · ${hit} · ${roi} (n=${h2h.slips})`;
}

/**
 * Blend global AI helm ranks with Lab H2H recipe stats for this fixture.
 * Prefers high hit-rate matchup bands; demotes 0% H2H; keeps one lottery flutter.
 */
export function rankStrategiesForMatchup(
  policy: ActivePolicyView,
  playbook: MatchupPlaybook | null,
  k = PORTFOLIO_K,
): { selected: PlaybookNote[]; compared: PlaybookNote[] } {
  const globalByKey = new Map(
    (policy.weights.strategies ?? []).map((s) => [s.strategyKey, s]),
  );
  const h2hByKey = new Map(
    (playbook?.strategies ?? []).map((s) => [s.strategyKey, s]),
  );

  // Production matrix + H2H recipes with a real sample (skip 1-slip noise).
  const catalogKeys = new Set<string>([
    ...BACKTEST_STRATEGIES.map((s) => s.key),
    ...[...h2hByKey.entries()]
      .filter(([, s]) => s.slips >= 2)
      .map(([key]) => key),
  ]);

  const notes: PlaybookNote[] = [];

  for (const key of catalogKeys) {
    const global = globalByKey.get(key);
    const h2h = h2hByKey.get(key);
    const focus =
      global?.focus ??
      h2h?.focus ??
      BACKTEST_STRATEGIES.find((s) => s.key === key)?.focus;
    const legCount =
      global?.legCount ??
      h2h?.legCount ??
      BACKTEST_STRATEGIES.find((s) => s.key === key)?.legCount;
    const label =
      global?.label ??
      h2h?.label ??
      BACKTEST_STRATEGIES.find((s) => s.key === key)?.label ??
      key;
    if (focus == null || legCount == null) continue;

    const globalScore = global?.score ?? 0;
    // Inflate H2H N so 3–5 meetings still influence score (global uses min 50).
    const h2hScore = h2h
      ? scoreStrategy(
          h2h.slipHitRate,
          h2h.flatRoi,
          Math.min(50, Math.max(h2h.slips, 1) * 10),
        )
      : 0;

    let combined = globalScore;
    if (playbook && playbook.meetings > 0) {
      combined = 0.4 * globalScore + 0.6 * h2hScore;
      if (h2h && h2h.slips >= 2) {
        if ((h2h.slipHitRate ?? 0) >= 0.5) combined += 0.35;
        if ((h2h.slipHitRate ?? 0) >= 0.4) combined += 0.12;
        if (
          (h2h.slipHitRate ?? 0) === 0 &&
          (h2h.flatRoi ?? 0) <= -0.99
        ) {
          combined -= 0.8;
        }
      }
    }

    const isLottery =
      !!h2h &&
      h2h.slips >= 2 &&
      (h2h.slipHitRate ?? 1) <= 0.25 &&
      (h2h.flatRoi ?? 0) >= 1;

    notes.push({
      strategyKey: key,
      label,
      focus,
      legCount,
      h2hHitRate: h2h?.slipHitRate ?? null,
      h2hRoi: h2h?.flatRoi ?? null,
      h2hSlips: h2h?.slips ?? 0,
      globalScore,
      h2hScore,
      combinedScore: isLottery ? Math.min(combined, 0.15) : combined,
      tier: "low",
      why: "",
    });
  }

  notes.sort(
    (a, b) =>
      b.combinedScore - a.combinedScore ||
      (b.h2hHitRate ?? 0) - (a.h2hHitRate ?? 0) ||
      b.globalScore - a.globalScore,
  );

  const isDead = (n: PlaybookNote) =>
    n.h2hSlips >= 2 &&
    (n.h2hHitRate ?? 0) === 0 &&
    (n.h2hRoi ?? 0) <= -0.99;

  const isLotteryNote = (n: PlaybookNote) =>
    n.h2hSlips >= 2 &&
    (n.h2hHitRate ?? 1) <= 0.25 &&
    (n.h2hRoi ?? 0) >= 1;

  // Core pool: reliable H2H — no dead, no lottery, no negative H2H ROI dogs.
  const corePool = notes.filter(
    (n) =>
      !isDead(n) &&
      !isLotteryNote(n) &&
      (n.h2hSlips < 2 || (n.h2hRoi ?? 0) >= 0),
  );
  const pool =
    corePool.length >= Math.min(3, k)
      ? corePool
      : notes.filter((n) => !isDead(n) && !isLotteryNote(n));

  const core: PlaybookNote[] = [];
  for (const n of pool) {
    if (core.length >= Math.max(1, k - 1)) break;
    const copy = { ...n };
    const hit = copy.h2hHitRate;
    if (hit != null && hit >= 0.5 && copy.h2hSlips >= 2) copy.tier = "banker";
    else if (hit != null && hit >= 0.4 && copy.h2hSlips >= 2) {
      copy.tier = core.length < 3 ? "banker" : "balanced";
    } else if (core.filter((c) => c.tier === "banker").length < 3) {
      copy.tier = core.length < 3 ? "banker" : "balanced";
    } else copy.tier = "balanced";
    copy.why = whyNote(h2hByKey.get(copy.strategyKey), copy.tier);
    core.push(copy);
  }

  const selectedKeys = new Set(core.map((c) => c.strategyKey));

  // Fill remaining core slots (leave last slot for FUN).
  const fillPool = pool
    .filter((n) => !selectedKeys.has(n.strategyKey))
    .filter((n) => n.h2hSlips < 2 || (n.h2hRoi ?? 0) >= 0)
    .sort(
      (a, b) =>
        b.combinedScore - a.combinedScore ||
        (b.h2hHitRate ?? 0) - (a.h2hHitRate ?? 0),
    );

  const selected = [...core];
  for (const next of fillPool) {
    if (selected.length >= Math.max(1, k - 1)) break;
    selectedKeys.add(next.strategyKey);
    selected.push({
      ...next,
      tier: "balanced",
      why: whyNote(h2hByKey.get(next.strategyKey), "balanced"),
    });
  }

  // Always end with one FUN Any long-shot (huge upside / $5 flutter).
  const fun = pickFunAnyFlutter(notes, selectedKeys, h2hByKey);
  selectedKeys.add(fun.strategyKey);
  selected.push(fun);

  selected.forEach((s, i) => {
    (s as PlaybookNote & { rank?: number }).rank = i + 1;
  });

  return { selected, compared: notes.slice(0, 24) };
}

/**
 * Prefer a long Any recipe for the FUN slot — lottery H2H first, else longest
 * Any in catalog, else synthesize any_10 / any_12.
 */
function pickFunAnyFlutter(
  notes: PlaybookNote[],
  selectedKeys: Set<string>,
  h2hByKey: Map<string, StrategySummary>,
): PlaybookNote {
  const anyNotes = notes.filter(
    (n) => n.focus === "any" && !selectedKeys.has(n.strategyKey),
  );

  const lotteryAny = anyNotes
    .filter(
      (n) =>
        n.legCount >= 10 &&
        n.h2hSlips >= 2 &&
        (n.h2hHitRate ?? 1) <= 0.25 &&
        (n.h2hRoi ?? 0) >= 1,
    )
    .sort(
      (a, b) =>
        b.legCount - a.legCount || (b.h2hRoi ?? 0) - (a.h2hRoi ?? 0),
    )[0];

  if (lotteryAny) {
    return {
      ...lotteryAny,
      tier: "fun",
      why: `FUN flutter · long Any · ${lotteryAny.legCount} legs — small stake, huge upside`,
    };
  }

  const longAny = [...anyNotes]
    .filter((n) => n.legCount >= 10)
    .sort((a, b) => b.legCount - a.legCount || (b.h2hRoi ?? 0) - (a.h2hRoi ?? 0))[0];

  if (longAny) {
    return {
      ...longAny,
      tier: "fun",
      why: `FUN flutter · Any · ${longAny.legCount} legs — $5 lottery ticket`,
    };
  }

  // Synthesize a long Any (min 10 legs) even if not in H2H top notes.
  for (const legs of [12, 11, 10]) {
    const key = `any_${legs}`;
    if (selectedKeys.has(key)) continue;
    const h2h = h2hByKey.get(key);
    return {
      strategyKey: key,
      label: `Any · ${legs} legs`,
      focus: "any",
      legCount: legs,
      h2hHitRate: h2h?.slipHitRate ?? null,
      h2hRoi: h2h?.flatRoi ?? null,
      h2hSlips: h2h?.slips ?? 0,
      globalScore: 0,
      h2hScore: 0,
      combinedScore: 0,
      tier: "fun",
      why: `FUN flutter · Any · ${legs} legs — off-chance huge ROI ($5)`,
    };
  }

  const fallback = BACKTEST_STRATEGIES.find((s) => s.key === "any_10");
  return {
    strategyKey: "any_10",
    label: fallback?.label ?? "Any · 10 legs",
    focus: "any",
    legCount: 10,
    h2hHitRate: null,
    h2hRoi: null,
    h2hSlips: 0,
    globalScore: 0,
    h2hScore: 0,
    combinedScore: 0,
    tier: "fun",
    why: "FUN flutter · Any · 10 legs — off-chance huge ROI ($5)",
  };
}

/** Map playbook notes → policy-shaped weights for ticket build. */
export function notesToWeights(notes: PlaybookNote[]): SystemStrategyWeight[] {
  return notes.map((n, i) => ({
    strategyKey: n.strategyKey,
    focus: n.focus,
    legCount: n.legCount,
    label: n.label,
    score: n.combinedScore,
    rank: i + 1,
    tier:
      n.tier === "fun"
        ? "fun"
        : n.tier === "banker"
          ? "banker"
          : n.tier === "low"
            ? "low"
            : "balanced",
    slipHitRate: n.h2hHitRate,
    flatRoi: n.h2hRoi,
    slips: n.h2hSlips,
  }));
}
