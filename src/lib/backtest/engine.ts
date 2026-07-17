import type { PlayerGameLogEntry, PlayerHistory } from "@/lib/ingest/aflTables";
import { recentFantasyAverage } from "@/lib/ingest/aflTables";
import { modelPropLine } from "@/lib/predictions/modelLine";
import { clearProbability } from "@/lib/predictions/probability";
import { modelC, runAllModels } from "@/lib/predictions/engine";
import { buildInputs, STAT_TYPES, type FeatureContext } from "@/lib/predictions/features";
import type { StatFocus } from "@/lib/predictions/suggest";
import type { StatType } from "@/db/schema";
import { DEFAULT_PARAMS } from "@/lib/predictions/types";
import {
  BACKTEST_STRATEGIES,
  type BacktestStrategy,
} from "./matrix";

export interface BuildStrategySlipsOptions {
  /** Defaults to production 3/6/10 matrix. */
  strategies?: BacktestStrategy[];
  /**
   * When true, players used on an earlier slip are excluded from later slips
   * in the same game (spread risk). Strategies are processed shortest-first
   * so short tickets keep the strongest names.
   */
  spreadPlayers?: boolean;
}

export interface BacktestCandidate {
  playerName: string;
  team: string;
  jumper: number | null;
  fantasyAvg: number | null;
  statType: StatType;
  prediction: number;
  line: number;
  confidence: number;
  edge: number;
  recentForm: number[];
  actual: number;
}

export interface BacktestLegResult {
  playerName: string;
  team: string;
  statType: StatType;
  line: number;
  prediction: number;
  confidence: number;
  actualValue: number;
  hit: boolean;
}

export interface BacktestSlipResult {
  strategyKey: string;
  focus: string;
  legCount: number;
  modelledChance: number | null;
  estOdds: number | null;
  legs: BacktestLegResult[];
  legsHit: number;
  legsTotal: number;
  slipHit: boolean;
  flatReturn: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function oddsFromConfidence(confidence: number): number {
  const p = clamp(confidence, 0.03, 0.92);
  return Math.round((1 / p) * 100) / 100;
}

/** Normalise AFL Tables / Squiggle round labels for matching. */
export function normaliseRound(round: string | number | null | undefined): string {
  if (round == null) return "";
  const s = String(round).trim().toUpperCase();
  const digits = s.replace(/[^0-9]/g, "");
  if (digits) return digits;
  return s;
}

/**
 * Index of the walk-forward game in a player's log.
 *
 * Squiggle uses round 0 for Opening Round; AFL Tables numbers that same
 * game as round 1 and shifts the rest by +1. When `seasonHasOpeningRound`
 * is true we accept that offset. Falls back to a unique season+opponent hit.
 */
export function findGameLogIndex(
  log: PlayerGameLogEntry[],
  season: number,
  round: number | null,
  opponent: string,
  seasonHasOpeningRound = false,
): number {
  const vsOpp = log
    .map((g, idx) => ({ g, idx }))
    .filter(({ g }) => g.season === season && g.opponent === opponent);
  if (vsOpp.length === 0) return -1;

  const want = normaliseRound(round);
  const exact = vsOpp.find(({ g }) => normaliseRound(g.round) === want);
  if (exact) return exact.idx;

  if (seasonHasOpeningRound && round != null && Number.isFinite(Number(round))) {
    const offsetWant = String(Number(round) + 1);
    const offset = vsOpp.find(({ g }) => normaliseRound(g.round) === offsetWant);
    if (offset) return offset.idx;
  }

  // Unique matchup that season (bye weeks / missed games).
  if (vsOpp.length === 1) return vsOpp[0]!.idx;
  return -1;
}

/**
 * Split a player's log at a completed game: prior games (for features) +
 * the actuals for that game. Returns null if they didn't play.
 */
export function splitLogAtGame(
  log: PlayerGameLogEntry[],
  season: number,
  round: number | null,
  opponent: string,
  seasonHasOpeningRound = false,
): { prior: PlayerGameLogEntry[]; actual: PlayerGameLogEntry } | null {
  const idx = findGameLogIndex(
    log,
    season,
    round,
    opponent,
    seasonHasOpeningRound,
  );
  if (idx < 0) return null;
  return { prior: log.slice(0, idx), actual: log[idx]! };
}

function pickN(pool: BacktestCandidate[], n: number): BacktestCandidate[] {
  const out: BacktestCandidate[] = [];
  const usedPlayers = new Set<string>();
  const usedLegs = new Set<string>();
  const legKey = (l: BacktestCandidate) => `${l.playerName}:${l.statType}`;

  for (const l of pool) {
    if (out.length >= n) break;
    if (usedPlayers.has(l.playerName)) continue;
    out.push(l);
    usedPlayers.add(l.playerName);
    usedLegs.add(legKey(l));
  }
  if (out.length < n) {
    for (const l of pool) {
      if (out.length >= n) break;
      if (usedLegs.has(legKey(l))) continue;
      out.push(l);
      usedLegs.add(legKey(l));
    }
  }
  return out;
}

function pickBestPerPlayer(pool: BacktestCandidate[], n: number): BacktestCandidate[] {
  const positive = pool.filter((l) => l.edge > 0);
  const source = positive.length > 0 ? positive : pool;
  const maxFantasy = Math.max(0, ...source.map((l) => l.fantasyAvg ?? 0));
  const score = (l: BacktestCandidate) =>
    l.confidence + (maxFantasy > 0 ? 0.2 * ((l.fantasyAvg ?? 0) / maxFantasy) : 0);

  const bestByPlayer = new Map<string, BacktestCandidate>();
  for (const l of source) {
    const prev = bestByPlayer.get(l.playerName);
    if (!prev || score(l) > score(prev)) bestByPlayer.set(l.playerName, l);
  }

  const ranked = [...bestByPlayer.values()].sort((a, b) => score(b) - score(a));
  const out: BacktestCandidate[] = [];
  const usedLegs = new Set<string>();
  const legKey = (l: BacktestCandidate) => `${l.playerName}:${l.statType}`;

  for (const l of ranked) {
    if (out.length >= n) break;
    out.push(l);
    usedLegs.add(legKey(l));
  }
  if (out.length < n) {
    const rest = [...source]
      .filter((l) => !usedLegs.has(legKey(l)))
      .sort((a, b) => score(b) - score(a));
    for (const l of rest) {
      if (out.length >= n) break;
      out.push(l);
      usedLegs.add(legKey(l));
    }
  }
  return out;
}

export interface ProjectedPlayer {
  playerName: string;
  team: string;
  jumper: number | null;
  fantasyAvg: number | null;
  candidates: BacktestCandidate[];
}

/**
 * Walk-forward project one player who played this game: features from prior
 * games only; actuals from the game itself. No injury RSS / personal history.
 */
export function projectPlayerForBacktest(
  playerName: string,
  team: string,
  history: PlayerHistory,
  season: number,
  round: number | null,
  opponent: string,
  venue: string | null,
  seasonHasOpeningRound = false,
): ProjectedPlayer | null {
  const split = splitLogAtGame(
    history.gameLog,
    season,
    round,
    opponent,
    seasonHasOpeningRound,
  );
  if (!split || split.prior.length < 3) return null;

  const priorHistory: PlayerHistory = {
    ...history,
    gameLog: split.prior,
  };
  const ctx: FeatureContext = {
    season,
    opponent,
    venue,
    formWindow: DEFAULT_PARAMS.formWindow,
    teamFactors: null,
    playerFactors: null, // no live calibration leakage
  };
  const inputs = buildInputs(priorHistory, ctx);
  const fantasyAvg = recentFantasyAverage(split.prior, 5);
  const jumper = split.actual.jumper ?? history.jumper;
  const candidates: BacktestCandidate[] = [];

  for (const input of inputs) {
    const prediction =
      runAllModels(input).find((m) => m.model === "C")?.predictedValue ?? modelC(input);
    const line = modelPropLine(input.statType, prediction);
    if (line == null || prediction <= line) continue;
    const form = input.recentForm;
    const confidence = clearProbability({ prediction, line, form });
    const actual = split.actual[input.statType];
    candidates.push({
      playerName,
      team,
      jumper,
      fantasyAvg,
      statType: input.statType,
      prediction,
      line,
      confidence,
      edge: prediction - line,
      recentForm: form,
      actual,
    });
  }

  if (candidates.length === 0) return null;
  return { playerName, team, jumper, fantasyAvg, candidates };
}

function buildSlip(
  strategyKey: string,
  focus: StatFocus,
  legCount: number,
  picked: BacktestCandidate[],
): BacktestSlipResult | null {
  if (picked.length === 0) return null;
  const legs: BacktestLegResult[] = picked.map((l) => {
    const hit = l.actual > l.line;
    return {
      playerName: l.playerName,
      team: l.team,
      statType: l.statType,
      line: l.line,
      prediction: l.prediction,
      confidence: l.confidence,
      actualValue: l.actual,
      hit,
    };
  });
  const legsHit = legs.filter((l) => l.hit).length;
  const slipHit = legsHit === legs.length;
  const modelledChance = legs.reduce((p, l) => p * l.confidence, 1);
  const estOdds = legs.reduce((p, l) => p * oddsFromConfidence(l.confidence), 1);
  return {
    strategyKey,
    focus,
    legCount,
    modelledChance,
    estOdds: Math.round(estOdds * 100) / 100,
    legs,
    legsHit,
    legsTotal: legs.length,
    slipHit,
    flatReturn: slipHit ? Math.round(estOdds * 100) / 100 : 0,
  };
}

/** Build strategy slips for one game from projected candidates. */
export function buildStrategySlips(
  allCandidates: BacktestCandidate[],
  opts?: BuildStrategySlipsOptions,
): BacktestSlipResult[] {
  const strategies = [...(opts?.strategies ?? BACKTEST_STRATEGIES)];
  if (opts?.spreadPlayers) {
    strategies.sort((a, b) => a.legCount - b.legCount || a.key.localeCompare(b.key));
  }

  const slips: BacktestSlipResult[] = [];
  const usedPlayers = new Set<string>();

  for (const strategy of strategies) {
    let pool =
      strategy.focus === "any"
        ? allCandidates
        : allCandidates.filter((c) => c.statType === strategy.focus);

    if (opts?.spreadPlayers && usedPlayers.size > 0) {
      pool = pool.filter((c) => !usedPlayers.has(c.playerName));
    }

    const ranked =
      strategy.focus === "any"
        ? pickBestPerPlayer(
            [...pool].sort((a, b) => b.confidence - a.confidence),
            strategy.legCount,
          )
        : pickN(
            [...pool].sort((a, b) => b.confidence - a.confidence),
            strategy.legCount,
          );

    // Only keep full tickets (skip thin games that can't fill the multi).
    if (ranked.length < strategy.legCount) continue;
    const slip = buildSlip(strategy.key, strategy.focus, strategy.legCount, ranked);
    if (!slip) continue;
    slips.push(slip);
    if (opts?.spreadPlayers) {
      for (const l of slip.legs) usedPlayers.add(l.playerName);
    }
  }

  return slips;
}

export { STAT_TYPES };
