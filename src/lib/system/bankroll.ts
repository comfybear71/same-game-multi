import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  backtestRuns,
  backtestSlips,
  bankrollCheckpoints,
  bankrollRoundLog,
  bankrollRuns,
  games,
  type BankrollParams,
  type SystemPolicyWeights,
  type SystemStrategyWeight,
} from "@/db/schema";
import { BACKTEST_STRATEGIES } from "@/lib/backtest/matrix";
import { listBacktestRuns } from "@/lib/data/backtest";
import { PORTFOLIO_K, scoreStrategy } from "@/lib/system/policy";

export const DEFAULT_BANKROLL_PARAMS: BankrollParams = {
  startUnit: 10,
  portfolioK: PORTFOLIO_K,
  growPct: 0.1,
  topUp: 10,
  unitCap: 50,
};

type SlipRow = {
  gameId: number;
  season: number;
  round: number | null;
  commenceTime: Date;
  strategyKey: string;
  slipHit: boolean;
  estOdds: number | null;
  flatReturn: number;
};

function coldStartWeights(): SystemStrategyWeight[] {
  // Prefer short tickets until we have graded history.
  const ranked: SystemStrategyWeight[] = BACKTEST_STRATEGIES.map((s) => {
    const shortBoost = s.legCount === 3 ? 1 : s.legCount === 6 ? 0.45 : 0.15;
    const focusBoost =
      s.focus === "disposals" ? 0.08 : s.focus === "any" ? 0.05 : s.focus === "goals" ? 0.03 : 0;
    return {
      strategyKey: s.key,
      focus: s.focus,
      legCount: s.legCount,
      label: s.label,
      score: shortBoost + focusBoost,
      rank: 0,
      tier: "low" as SystemStrategyWeight["tier"],
      slipHitRate: null,
      flatRoi: null,
      slips: 0,
    };
  }).sort((a, b) => b.score - a.score);

  ranked.forEach((s, i) => {
    s.rank = i + 1;
    s.tier = i < 3 ? "banker" : i < 8 ? "balanced" : "low";
  });
  return ranked;
}

/** Build ranked strategy weights from graded slips (walk-forward prefix). */
export function weightsFromSlips(
  slips: { strategyKey: string; slipHit: boolean; flatReturn: number }[],
): SystemStrategyWeight[] {
  if (slips.length === 0) return coldStartWeights();

  const byKey = new Map<
    string,
    { slips: number; hits: number; flatReturned: number }
  >();
  for (const s of slips) {
    const cur = byKey.get(s.strategyKey) ?? { slips: 0, hits: 0, flatReturned: 0 };
    cur.slips++;
    if (s.slipHit) cur.hits++;
    cur.flatReturned += s.flatReturn;
    byKey.set(s.strategyKey, cur);
  }

  const ranked: SystemStrategyWeight[] = BACKTEST_STRATEGIES.map((s) => {
    const hit = byKey.get(s.key);
    const n = hit?.slips ?? 0;
    const slipHitRate = n > 0 ? hit!.hits / n : null;
    const flatRoi = n > 0 ? (hit!.flatReturned - n) / n : null;
    return {
      strategyKey: s.key,
      focus: s.focus,
      legCount: s.legCount,
      label: s.label,
      score: scoreStrategy(slipHitRate, flatRoi, n),
      rank: 0,
      tier: "low" as SystemStrategyWeight["tier"],
      slipHitRate,
      flatRoi,
      slips: n,
    };
  }).sort((a, b) => b.score - a.score || b.slips - a.slips);

  ranked.forEach((s, i) => {
    s.rank = i + 1;
    s.tier = i < 3 ? "banker" : i < 8 ? "balanced" : "low";
  });
  return ranked;
}

function roundKey(season: number, round: number | null): string {
  return `${season}:${round ?? -1}`;
}

async function resolveSourceRunId(preferred?: number): Promise<number> {
  if (preferred != null) {
    const [row] = await db
      .select({ id: backtestRuns.id, slips: backtestRuns.slipsWritten })
      .from(backtestRuns)
      .where(eq(backtestRuns.id, preferred))
      .limit(1);
    if (row && row.slips > 0) return row.id;
  }
  const runs = await listBacktestRuns(30);
  const full = runs
    .filter((r) => r.label.startsWith("full-") || (r.seasons?.length ?? 0) >= 2)
    .sort((a, b) => b.slipsWritten - a.slipsWritten)[0];
  if (full) return full.id;
  const any = runs[0];
  if (!any) throw new Error("No Strategy lab run with slips — run a full backtest first.");
  return any.id;
}

/**
 * Walk-forward dollar sim: recompute policy each round from prior slips only,
 * stake unit across top-K, grow/top-up unit, checkpoint each season end.
 */
export async function runBankrollSim(opts?: {
  sourceRunId?: number;
  label?: string;
  params?: Partial<BankrollParams>;
}): Promise<{ runId: number }> {
  const params: BankrollParams = { ...DEFAULT_BANKROLL_PARAMS, ...opts?.params };
  const sourceRunId = await resolveSourceRunId(opts?.sourceRunId);

  const [source] = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.id, sourceRunId))
    .limit(1);

  const [run] = await db
    .insert(bankrollRuns)
    .values({
      label: opts?.label ?? `bankroll-${source?.label ?? sourceRunId}`,
      sourceRunId,
      params,
      status: "running",
    })
    .returning();

  const runId = run!.id;

  try {
    const slipRows = await db
      .select({
        gameId: backtestSlips.gameId,
        strategyKey: backtestSlips.strategyKey,
        slipHit: backtestSlips.slipHit,
        estOdds: backtestSlips.estOdds,
        flatReturn: backtestSlips.flatReturn,
        season: backtestSlips.season,
        round: backtestSlips.round,
        commenceTime: games.commenceTime,
      })
      .from(backtestSlips)
      .innerJoin(games, eq(games.id, backtestSlips.gameId))
      .where(eq(backtestSlips.runId, sourceRunId))
      .orderBy(asc(games.commenceTime), asc(backtestSlips.gameId));

    if (slipRows.length === 0) {
      throw new Error(`Source run #${sourceRunId} has no slips.`);
    }

    // Deduplicate to one row per game×strategy (should already be unique).
    const slips: SlipRow[] = slipRows.map((r) => ({
      gameId: r.gameId,
      season: r.season,
      round: r.round,
      commenceTime: r.commenceTime,
      strategyKey: r.strategyKey,
      slipHit: r.slipHit,
      estOdds: r.estOdds,
      flatReturn: r.flatReturn,
    }));

    const gameIds = [...new Set(slips.map((s) => s.gameId))];
    const gameMeta = new Map<
      number,
      { season: number; round: number | null; commenceTime: Date }
    >();
    for (const s of slips) {
      if (!gameMeta.has(s.gameId)) {
        gameMeta.set(s.gameId, {
          season: s.season,
          round: s.round,
          commenceTime: s.commenceTime,
        });
      }
    }

    // Group games into rounds (season, round) ordered by first commenceTime.
    const roundsOrder: { season: number; round: number; gameIds: number[] }[] = [];
    const roundMap = new Map<string, { season: number; round: number; gameIds: number[]; t: number }>();
    for (const gid of gameIds) {
      const m = gameMeta.get(gid)!;
      const r = m.round ?? 0;
      const key = roundKey(m.season, r);
      let bucket = roundMap.get(key);
      if (!bucket) {
        bucket = { season: m.season, round: r, gameIds: [], t: m.commenceTime.getTime() };
        roundMap.set(key, bucket);
      }
      bucket.gameIds.push(gid);
      bucket.t = Math.min(bucket.t, m.commenceTime.getTime());
    }
    const orderedRounds = [...roundMap.values()].sort(
      (a, b) => a.t - b.t || a.season - b.season || a.round - b.round,
    );
    for (const r of orderedRounds) {
      roundsOrder.push({ season: r.season, round: r.round, gameIds: r.gameIds });
    }

    const slipsByGame = new Map<number, SlipRow[]>();
    for (const s of slips) {
      const list = slipsByGame.get(s.gameId) ?? [];
      list.push(s);
      slipsByGame.set(s.gameId, list);
    }

    let unit = params.startUnit;
    let bank = 0;
    let capitalInjected = 0;
    let gamesPlayed = 0;
    let ticketsPlaced = 0;
    let ticketsHit = 0;
    let priorSlips: SlipRow[] = [];
    let lastWeights = coldStartWeights();

    const seasonsSeen = [...new Set(orderedRounds.map((r) => r.season))].sort();

    for (let ri = 0; ri < orderedRounds.length; ri++) {
      const rnd = orderedRounds[ri]!;
      const weights = weightsFromSlips(priorSlips);
      lastWeights = weights;
      const topK = weights.slice(0, params.portfolioK);
      const policyTop = topK.slice(0, 5).map((w) => w.strategyKey);

      const unitBefore = unit;
      let roundStake = 0;
      let roundReturns = 0;
      let roundTickets = 0;
      let roundHits = 0;
      let roundGames = 0;

      for (const gameId of rnd.gameIds) {
        const gameSlips = slipsByGame.get(gameId) ?? [];
        const byKey = new Map(gameSlips.map((s) => [s.strategyKey, s]));
        const placed = topK.filter((w) => byKey.has(w.strategyKey));
        if (placed.length === 0) continue;

        const bankers = placed.filter((p) => p.tier === "banker");
        const rest = placed.filter((p) => p.tier !== "banker");
        // 50% unit on bankers (equal), 50% on rest (equal). If one side empty, all on the other.
        const bankerPool = bankers.length > 0 ? unit * 0.5 : 0;
        const restPool = rest.length > 0 ? (bankers.length > 0 ? unit * 0.5 : unit) : bankers.length > 0 ? unit : 0;
        // If no bankers, rest gets full unit; if no rest, bankers get full unit.
        const bankerBudget = bankers.length > 0 ? (rest.length > 0 ? bankerPool : unit) : 0;
        const restBudget = rest.length > 0 ? (bankers.length > 0 ? restPool : unit) : 0;

        const stakeFor = (group: typeof placed, budget: number) =>
          group.length > 0 ? budget / group.length : 0;

        const bankerStake = stakeFor(bankers, bankerBudget);
        const restStake = stakeFor(rest, restBudget);

        for (const w of placed) {
          const slip = byKey.get(w.strategyKey)!;
          const stake = w.tier === "banker" ? bankerStake : restStake;
          if (stake <= 0) continue;
          const ret =
            slip.slipHit && slip.estOdds != null && slip.estOdds > 0
              ? stake * slip.estOdds
              : 0;
          roundStake += stake;
          roundReturns += ret;
          roundTickets++;
          if (slip.slipHit) roundHits++;
        }
        roundGames++;
      }

      // Fund the round stake from capital if bank can't cover (starting from $0).
      const need = Math.max(0, roundStake - bank);
      if (need > 0) {
        capitalInjected += need;
        bank += need;
      }
      bank = bank - roundStake + roundReturns;
      const pnl = roundReturns - roundStake;

      gamesPlayed += roundGames;
      ticketsPlaced += roundTickets;
      ticketsHit += roundHits;

      // Unit update rules.
      let notes = "";
      const noWins = roundHits === 0 && roundTickets > 0;
      const belowStart = bank < capitalInjected; // net underwater vs capital in
      // Plan: grow on round profit; top-up if no wins OR cumulative bank < starting (net < 0).
      const netProfit = bank - capitalInjected;
      if (pnl > 0) {
        unit = Math.min(params.unitCap, unit * (1 + params.growPct));
        notes = `profit +${pnl.toFixed(2)} → unit ×${1 + params.growPct}`;
      }
      if (noWins || netProfit < 0) {
        unit = Math.min(params.unitCap, unit + params.topUp);
        notes = notes
          ? `${notes}; top-up +${params.topUp}`
          : `top-up +${params.topUp} (${noWins ? "no hits" : "underwater"})`;
      }
      if (!notes) notes = "flat unit";

      await db.insert(bankrollRoundLog).values({
        runId,
        season: rnd.season,
        round: rnd.round,
        unitBefore,
        unitAfter: unit,
        stake: roundStake,
        returns: roundReturns,
        pnl,
        bankAfter: bank,
        capitalInjected,
        games: roundGames,
        ticketsPlaced: roundTickets,
        ticketsHit: roundHits,
        policyTop,
        notes,
      });

      // Append this round's slips into prior for next policy.
      for (const gameId of rnd.gameIds) {
        priorSlips.push(...(slipsByGame.get(gameId) ?? []));
      }

      // Season checkpoint when season changes next or this is the last round.
      const next = orderedRounds[ri + 1];
      const seasonEnding = !next || next.season !== rnd.season;
      if (seasonEnding) {
        await db.insert(bankrollCheckpoints).values({
          runId,
          season: rnd.season,
          afterRound: rnd.round,
          unit,
          bank,
          capitalInjected,
          netProfit: bank - capitalInjected,
          gamesPlayed,
          ticketsPlaced,
          ticketsHit,
        });
      }
    }

    const learnedPolicy: SystemPolicyWeights = { strategies: lastWeights };
    const top = lastWeights[0];
    const rationale = `Walk-forward from run #${sourceRunId} (${source?.label ?? "?"}). Final unit $${unit.toFixed(2)}, bank $${bank.toFixed(2)}, capital in $${capitalInjected.toFixed(2)}, net $${(bank - capitalInjected).toFixed(2)}. Learned favourite: ${top?.label ?? "—"}. Seasons: ${seasonsSeen.join(", ")}.`;

    await db
      .update(bankrollRuns)
      .set({
        status: "complete",
        finishedAt: new Date(),
        learnedPolicy,
        rationale,
        finalUnit: unit,
        finalBank: bank,
        capitalInjected,
        netProfit: bank - capitalInjected,
        gamesPlayed,
        ticketsPlaced,
        ticketsHit,
      })
      .where(eq(bankrollRuns.id, runId));

    return { runId };
  } catch (err) {
    await db
      .update(bankrollRuns)
      .set({
        status: "failed",
        error: (err as Error).message,
        finishedAt: new Date(),
      })
      .where(eq(bankrollRuns.id, runId));
    throw err;
  }
}

export interface BankrollSimView {
  run: {
    id: number;
    label: string;
    sourceRunId: number;
    status: string;
    params: BankrollParams;
    rationale: string | null;
    finalUnit: number | null;
    finalBank: number | null;
    capitalInjected: number;
    netProfit: number | null;
    gamesPlayed: number;
    ticketsPlaced: number;
    ticketsHit: number;
    learnedTop: SystemStrategyWeight[];
    finishedAt: Date | null;
  } | null;
  checkpoints: {
    season: number;
    afterRound: number | null;
    unit: number;
    bank: number;
    capitalInjected: number;
    netProfit: number;
    gamesPlayed: number;
    ticketsPlaced: number;
    ticketsHit: number;
  }[];
  rounds: {
    season: number;
    round: number;
    unitBefore: number;
    unitAfter: number;
    stake: number;
    returns: number;
    pnl: number;
    bankAfter: number;
    capitalInjected: number;
    ticketsHit: number;
    ticketsPlaced: number;
    policyTop: string[];
    notes: string | null;
  }[];
}

/** Latest completed bankroll sim (or latest any). */
export async function getLatestBankrollSim(): Promise<BankrollSimView> {
  const runs = await db
    .select()
    .from(bankrollRuns)
    .orderBy(desc(bankrollRuns.startedAt))
    .limit(10);
  const run =
    runs.find((r) => r.status === "complete") ?? runs[0] ?? null;
  if (!run) {
    return { run: null, checkpoints: [], rounds: [] };
  }

  const [checkpoints, rounds] = await Promise.all([
    db
      .select()
      .from(bankrollCheckpoints)
      .where(eq(bankrollCheckpoints.runId, run.id))
      .orderBy(asc(bankrollCheckpoints.season)),
    db
      .select()
      .from(bankrollRoundLog)
      .where(eq(bankrollRoundLog.runId, run.id))
      .orderBy(asc(bankrollRoundLog.season), asc(bankrollRoundLog.round)),
  ]);

  return {
    run: {
      id: run.id,
      label: run.label,
      sourceRunId: run.sourceRunId,
      status: run.status,
      params: run.params,
      rationale: run.rationale,
      finalUnit: run.finalUnit,
      finalBank: run.finalBank,
      capitalInjected: run.capitalInjected,
      netProfit: run.netProfit,
      gamesPlayed: run.gamesPlayed,
      ticketsPlaced: run.ticketsPlaced,
      ticketsHit: run.ticketsHit,
      learnedTop: (run.learnedPolicy?.strategies ?? []).slice(0, 8),
      finishedAt: run.finishedAt,
    },
    checkpoints: checkpoints.map((c) => ({
      season: c.season,
      afterRound: c.afterRound,
      unit: c.unit,
      bank: c.bank,
      capitalInjected: c.capitalInjected,
      netProfit: c.netProfit,
      gamesPlayed: c.gamesPlayed,
      ticketsPlaced: c.ticketsPlaced,
      ticketsHit: c.ticketsHit,
    })),
    rounds: rounds.map((r) => ({
      season: r.season,
      round: r.round,
      unitBefore: r.unitBefore,
      unitAfter: r.unitAfter,
      stake: r.stake,
      returns: r.returns,
      pnl: r.pnl,
      bankAfter: r.bankAfter,
      capitalInjected: r.capitalInjected,
      ticketsHit: r.ticketsHit,
      ticketsPlaced: r.ticketsPlaced,
      policyTop: r.policyTop ?? [],
      notes: r.notes,
    })),
  };
}
