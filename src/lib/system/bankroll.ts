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
import { canonicalTeam } from "@/lib/afl/teams";
import { HISTORY_MIN_SEASON, listBacktestRuns } from "@/lib/data/backtest";
import { strategyKeyAllowed } from "@/lib/system/labFilters";
import { PORTFOLIO_K, scoreStrategy } from "@/lib/system/policy";

export const DEFAULT_BANKROLL_PARAMS: BankrollParams = {
  startUnit: 10,
  portfolioK: PORTFOLIO_K,
  growPct: 0.1,
  topUp: 10,
  unitCap: 50,
};

export type BankrollSimOpts = {
  sourceRunId?: number;
  label?: string;
  params?: Partial<BankrollParams>;
  /** Persist round log to DB (default true for CLI / Save). */
  persist?: boolean;
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

function metaFromKey(key: string): { focus: string; legCount: number; label: string } {
  const known = BACKTEST_STRATEGIES.find((s) => s.key === key);
  if (known) {
    return { focus: known.focus, legCount: known.legCount, label: known.label };
  }
  const m = key.match(/^([a-z]+)_(\d+)$/i);
  if (!m) return { focus: "any", legCount: 0, label: key };
  const focus = m[1]!.toLowerCase();
  const legCount = Number(m[2]);
  const focusLabel =
    focus === "any" ? "Any" : focus.charAt(0).toUpperCase() + focus.slice(1);
  return { focus, legCount, label: `${focusLabel} · ${legCount} legs` };
}

function coldStartWeights(catalog: string[]): SystemStrategyWeight[] {
  const keys =
    catalog.length > 0 ? catalog : BACKTEST_STRATEGIES.map((s) => s.key);
  const ranked: SystemStrategyWeight[] = keys.map((key) => {
    const meta = metaFromKey(key);
    const shortBoost =
      meta.legCount === 3 ? 1 : meta.legCount === 6 ? 0.45 : meta.legCount <= 10 ? 0.15 : 0.05;
    const focusBoost =
      meta.focus === "disposals"
        ? 0.08
        : meta.focus === "any"
          ? 0.05
          : meta.focus === "goals"
            ? 0.03
            : 0;
    return {
      strategyKey: key,
      focus: meta.focus,
      legCount: meta.legCount,
      label: meta.label,
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
  catalog?: string[],
): SystemStrategyWeight[] {
  const keys =
    catalog && catalog.length > 0
      ? catalog
      : [
          ...new Set([
            ...BACKTEST_STRATEGIES.map((s) => s.key),
            ...slips.map((s) => s.strategyKey),
          ]),
        ];

  if (slips.length === 0) return coldStartWeights(keys);

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

  const ranked: SystemStrategyWeight[] = keys.map((key) => {
    const meta = metaFromKey(key);
    const hit = byKey.get(key);
    const n = hit?.slips ?? 0;
    const slipHitRate = n > 0 ? hit!.hits / n : null;
    const flatRoi = n > 0 ? (hit!.flatReturned - n) / n : null;
    return {
      strategyKey: key,
      focus: meta.focus,
      legCount: meta.legCount,
      label: meta.label,
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

function applySlipFilters(
  slips: SlipRow[],
  params: BankrollParams,
  gameHomeAway: Map<number, { home: string; away: string }>,
): SlipRow[] {
  const focuses = params.focuses?.filter(Boolean) ?? null;
  const minLegs = params.minLegs ?? null;
  const maxLegs = params.maxLegs ?? null;
  const team = params.team ? canonicalTeam(params.team) ?? params.team : null;
  const teamA = params.teamA ? canonicalTeam(params.teamA) ?? params.teamA : null;
  const teamB = params.teamB ? canonicalTeam(params.teamB) ?? params.teamB : null;

  return slips.filter((s) => {
    if (focuses || minLegs != null || maxLegs != null) {
      if (
        !strategyKeyAllowed(
          s.strategyKey,
          focuses ?? ["goals", "tackles", "marks", "disposals", "any"],
          minLegs ?? 1,
          maxLegs ?? 99,
        )
      ) {
        return false;
      }
    }
    const sides = gameHomeAway.get(s.gameId);
    if (!sides) return true;
    const home = canonicalTeam(sides.home) ?? sides.home;
    const away = canonicalTeam(sides.away) ?? sides.away;
    if (teamA && teamB) {
      return (
        (home === teamA && away === teamB) || (home === teamB && away === teamA)
      );
    }
    if (team) return home === team || away === team;
    return true;
  });
}

type SimResult = {
  sourceRunId: number;
  sourceLabel: string;
  params: BankrollParams;
  rationale: string;
  finalUnit: number;
  finalBank: number;
  capitalInjected: number;
  netProfit: number;
  gamesPlayed: number;
  ticketsPlaced: number;
  ticketsHit: number;
  learnedPolicy: SystemPolicyWeights;
  checkpoints: BankrollSimView["checkpoints"];
  rounds: BankrollSimView["rounds"];
};

async function computeBankrollWalkForward(
  sourceRunId: number,
  params: BankrollParams,
): Promise<SimResult> {
  const [source] = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.id, sourceRunId))
    .limit(1);

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
      home: games.home,
      away: games.away,
    })
    .from(backtestSlips)
    .innerJoin(games, eq(games.id, backtestSlips.gameId))
    .where(eq(backtestSlips.runId, sourceRunId))
    .orderBy(asc(games.commenceTime), asc(backtestSlips.gameId));

  if (slipRows.length === 0) {
    throw new Error(`Source run #${sourceRunId} has no slips.`);
  }

  const gameHomeAway = new Map<number, { home: string; away: string }>();
  for (const r of slipRows) {
    if (!gameHomeAway.has(r.gameId)) {
      gameHomeAway.set(r.gameId, { home: r.home, away: r.away });
    }
  }

  let slips: SlipRow[] = slipRows.map((r) => ({
    gameId: r.gameId,
    season: r.season,
    round: r.round,
    commenceTime: r.commenceTime,
    strategyKey: r.strategyKey,
    slipHit: r.slipHit,
    estOdds: r.estOdds,
    flatReturn: r.flatReturn,
  }));
  slips = applySlipFilters(slips, params, gameHomeAway).filter(
    (s) => s.season >= HISTORY_MIN_SEASON,
  );

  if (slips.length === 0) {
    throw new Error("No slips left after market / legs / club filters.");
  }

  const catalog = [...new Set(slips.map((s) => s.strategyKey))];
  const flatStake =
    params.flatStake != null && params.flatStake > 0 ? params.flatStake : null;

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

  const roundMap = new Map<
    string,
    { season: number; round: number; gameIds: number[]; t: number }
  >();
  for (const gid of gameIds) {
    const m = gameMeta.get(gid)!;
    const r = m.round ?? 0;
    const key = roundKey(m.season, r);
    let bucket = roundMap.get(key);
    if (!bucket) {
      bucket = {
        season: m.season,
        round: r,
        gameIds: [],
        t: m.commenceTime.getTime(),
      };
      roundMap.set(key, bucket);
    }
    bucket.gameIds.push(gid);
    bucket.t = Math.min(bucket.t, m.commenceTime.getTime());
  }
  const orderedRounds = [...roundMap.values()].sort(
    (a, b) => a.t - b.t || a.season - b.season || a.round - b.round,
  );

  const slipsByGame = new Map<number, SlipRow[]>();
  for (const s of slips) {
    const list = slipsByGame.get(s.gameId) ?? [];
    list.push(s);
    slipsByGame.set(s.gameId, list);
  }

  let unit = flatStake ?? params.startUnit;
  let bank = 0;
  let capitalInjected = 0;
  let gamesPlayed = 0;
  let ticketsPlaced = 0;
  let ticketsHit = 0;
  const priorSlips: SlipRow[] = [];
  let lastWeights = coldStartWeights(catalog);

  const checkpoints: BankrollSimView["checkpoints"] = [];
  const rounds: BankrollSimView["rounds"] = [];
  const seasonsSeen = [...new Set(orderedRounds.map((r) => r.season))].sort();

  for (let ri = 0; ri < orderedRounds.length; ri++) {
    const rnd = orderedRounds[ri]!;
    const weights = weightsFromSlips(priorSlips, catalog);
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
      const bankerBudget =
        flatStake != null
          ? 0
          : bankers.length > 0
            ? rest.length > 0
              ? unit * 0.5
              : unit
            : 0;
      const restBudget =
        flatStake != null
          ? 0
          : rest.length > 0
            ? bankers.length > 0
              ? unit * 0.5
              : unit
            : 0;
      const bankerStake =
        bankers.length > 0 && flatStake == null ? bankerBudget / bankers.length : 0;
      const restStake =
        rest.length > 0 && flatStake == null ? restBudget / rest.length : 0;

      for (const w of placed) {
        const slip = byKey.get(w.strategyKey)!;
        const stake =
          flatStake != null
            ? flatStake
            : w.tier === "banker"
              ? bankerStake
              : restStake;
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

    let notes = "";
    if (flatStake != null) {
      unit = flatStake;
      notes = `flat $${flatStake}/ticket`;
    } else {
      const noWins = roundHits === 0 && roundTickets > 0;
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
    }

    rounds.push({
      season: rnd.season,
      round: rnd.round,
      unitBefore,
      unitAfter: unit,
      stake: roundStake,
      returns: roundReturns,
      pnl,
      bankAfter: bank,
      capitalInjected,
      ticketsHit: roundHits,
      ticketsPlaced: roundTickets,
      policyTop,
      notes,
    });

    for (const gameId of rnd.gameIds) {
      priorSlips.push(...(slipsByGame.get(gameId) ?? []));
    }

    const next = orderedRounds[ri + 1];
    const seasonEnding = !next || next.season !== rnd.season;
    if (seasonEnding) {
      checkpoints.push({
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
  const stakeNote =
    flatStake != null
      ? `Flat $${flatStake}/ticket`
      : `Unit $${params.startUnit} (grow/top-up)`;
  const filterBits: string[] = [];
  if (params.focuses?.length) filterBits.push(params.focuses.join("/"));
  if (params.minLegs != null || params.maxLegs != null) {
    filterBits.push(`legs ${params.minLegs ?? "?"}–${params.maxLegs ?? "?"}`);
  }
  if (params.teamA && params.teamB) {
    filterBits.push(`${params.teamA} v ${params.teamB}`);
  } else if (params.team) {
    filterBits.push(params.team);
  }
  const rationale = `Walk-forward from run #${sourceRunId} (${source?.label ?? "?"}). ${stakeNote}. ${filterBits.length ? `Filters: ${filterBits.join(" · ")}. ` : ""}Final bank $${bank.toFixed(2)}, capital in $${capitalInjected.toFixed(2)}, net $${(bank - capitalInjected).toFixed(2)}. Learned favourite: ${top?.label ?? "—"}. Seasons: ${seasonsSeen.join(", ")}.`;

  return {
    sourceRunId,
    sourceLabel: source?.label ?? String(sourceRunId),
    params,
    rationale,
    finalUnit: unit,
    finalBank: bank,
    capitalInjected,
    netProfit: bank - capitalInjected,
    gamesPlayed,
    ticketsPlaced,
    ticketsHit,
    learnedPolicy,
    checkpoints,
    rounds,
  };
}

function viewFromSim(sim: SimResult, runId: number, label: string, status: string): BankrollSimView {
  return {
    run: {
      id: runId,
      label,
      sourceRunId: sim.sourceRunId,
      status,
      params: sim.params,
      rationale: sim.rationale,
      finalUnit: sim.finalUnit,
      finalBank: sim.finalBank,
      capitalInjected: sim.capitalInjected,
      netProfit: sim.netProfit,
      gamesPlayed: sim.gamesPlayed,
      ticketsPlaced: sim.ticketsPlaced,
      ticketsHit: sim.ticketsHit,
      learnedTop: (sim.learnedPolicy.strategies ?? []).slice(0, 8),
      finishedAt: new Date(),
    },
    checkpoints: sim.checkpoints,
    rounds: sim.rounds,
  };
}

/** In-memory preview (no DB write) — used when lab filters / stake change. */
export async function previewBankrollSim(
  opts?: BankrollSimOpts,
): Promise<BankrollSimView> {
  const params: BankrollParams = { ...DEFAULT_BANKROLL_PARAMS, ...opts?.params };
  const sourceRunId = await resolveSourceRunId(opts?.sourceRunId);
  const sim = await computeBankrollWalkForward(sourceRunId, params);
  const label =
    opts?.label ?? `preview-${sim.sourceLabel}-$${params.flatStake ?? params.startUnit}`;
  return viewFromSim(sim, 0, label, "preview");
}

/**
 * Walk-forward dollar sim: recompute policy each round from prior slips only.
 * Persist=true (default) writes a bankroll run; false returns preview only.
 */
export async function runBankrollSim(
  opts?: BankrollSimOpts,
): Promise<{ runId: number; view: BankrollSimView }> {
  const params: BankrollParams = { ...DEFAULT_BANKROLL_PARAMS, ...opts?.params };
  const sourceRunId = await resolveSourceRunId(opts?.sourceRunId);
  const persist = opts?.persist !== false;

  if (!persist) {
    const view = await previewBankrollSim(opts);
    return { runId: 0, view };
  }

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
    const sim = await computeBankrollWalkForward(sourceRunId, params);

    if (sim.rounds.length > 0) {
      await db.insert(bankrollRoundLog).values(
        sim.rounds.map((r) => ({
          runId,
          season: r.season,
          round: r.round,
          unitBefore: r.unitBefore,
          unitAfter: r.unitAfter,
          stake: r.stake,
          returns: r.returns,
          pnl: r.pnl,
          bankAfter: r.bankAfter,
          capitalInjected: r.capitalInjected,
          games: 0,
          ticketsPlaced: r.ticketsPlaced,
          ticketsHit: r.ticketsHit,
          policyTop: r.policyTop,
          notes: r.notes,
        })),
      );
    }
    if (sim.checkpoints.length > 0) {
      await db.insert(bankrollCheckpoints).values(
        sim.checkpoints.map((c) => ({
          runId,
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
      );
    }

    await db
      .update(bankrollRuns)
      .set({
        status: "complete",
        finishedAt: new Date(),
        learnedPolicy: sim.learnedPolicy,
        rationale: sim.rationale,
        finalUnit: sim.finalUnit,
        finalBank: sim.finalBank,
        capitalInjected: sim.capitalInjected,
        netProfit: sim.netProfit,
        gamesPlayed: sim.gamesPlayed,
        ticketsPlaced: sim.ticketsPlaced,
        ticketsHit: sim.ticketsHit,
      })
      .where(eq(bankrollRuns.id, runId));

    const view = viewFromSim(
      sim,
      runId,
      opts?.label ?? `bankroll-${source?.label ?? sourceRunId}`,
      "complete",
    );
    return { runId, view };
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
