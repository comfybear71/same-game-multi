/**
 * DB-aware bridge: SuggestedLeg / System tickets → portfolioFill engine.
 * Pure fill maths stay in portfolioFill.ts.
 */

import { getPlayerBettingRecord, playerRecordKey } from "@/lib/data/bets";
import type { BenchmarkBand, GameBenchmarkMap } from "@/lib/data/leaders";
import {
  listModelCandidateLegs,
  type SuggestedLeg,
} from "@/lib/predictions/suggest";
import {
  computeEdgeModifiers,
  type EdgeScoreWeights,
} from "@/lib/system/edgeScore";
import { loadLastGameLeadersMap } from "@/lib/system/lastGameLeadersDb";
import {
  loadBookPricesForGame,
  pickPrice,
} from "@/lib/system/oddsPrices";
import {
  assembleSoftScore,
  bandSoftBonus,
  computeMetrics,
  edgePackageFillOptions,
  exposureKey,
  fillGreedy,
  fillSnakeDraft,
  isPortfolioEdgeScoreEnabled,
  resolveStatFamily,
  type FillCandidate,
  type FillOptions,
  type FillResult,
  type FilledTicket,
  type PortfolioMetrics,
  type TicketSlot,
} from "@/lib/system/portfolioFill";

export function suggestedLegToFillCandidate(
  leg: SuggestedLeg,
  band?: BenchmarkBand | "unknown" | null,
  history?: { hits: number; bets: number } | null,
): FillCandidate {
  const hits = history?.hits ?? leg.history?.hits;
  const bets = history?.bets ?? leg.history?.bets;
  const resolvedBand = (band ?? leg.benchmark ?? "unknown") as
    | "elite"
    | "above"
    | "average"
    | "below"
    | "unknown";
  return {
    playerId: leg.playerId,
    playerName: leg.playerName,
    team: leg.team,
    statType: leg.statType,
    statFamily: resolveStatFamily(leg.statType),
    line: leg.line,
    prediction: leg.prediction,
    odds: leg.odds,
    confidence: leg.confidence,
    band: resolvedBand,
    softScore: assembleSoftScore({
      confidence: leg.confidence,
      bandBonus: bandSoftBonus(resolvedBand),
      historyHits: hits,
      historyBets: bets,
    }),
    historyHits: hits,
    historyBets: bets,
    seasonAvg: leg.seasonAvg,
    recentForm: leg.recentForm,
  };
}

/** Apply edge / cushion / trend / last-game leaders onto a candidate (pure). */
export function applyEdgePackageToCandidate(
  c: FillCandidate,
  opts: {
    bookOdds: number | null;
    leaderRank: number | null;
    leaderLastValue: number | null;
    weights?: Partial<EdgeScoreWeights>;
  },
): FillCandidate {
  const mods = computeEdgeModifiers({
    modelProb: c.confidence,
    bookOdds: opts.bookOdds,
    line: c.line,
    seasonAvg: c.seasonAvg,
    recentForm: c.recentForm,
    leaderRank: opts.leaderRank,
    leaderLastValue: opts.leaderLastValue,
    weights: opts.weights,
  });
  const softScore = assembleSoftScore({
    confidence: c.confidence,
    bandBonus: bandSoftBonus(c.band),
    historyHits: c.historyHits,
    historyBets: c.historyBets,
    edgePackagePts: mods.totalPts,
  });
  return {
    ...c,
    bookOdds: mods.bookOdds,
    edge: mods.edge,
    impliedProb: mods.impliedProb,
    edgePts: mods.edgePts,
    cushionPts: mods.cushionPts,
    trendPts: mods.trendPts,
    leaderRank: mods.leaderRank,
    leaderLastValue: mods.leaderLastValue,
    leaderPts: mods.leaderPts,
    softScore,
  };
}

/** Load model candidate pool + attach personal tape for soft-score. */
export async function loadFillPool(
  gameId: number,
  bands: GameBenchmarkMap,
  userId?: number | null,
  opts?: {
    edgePackage?: boolean;
    edgeWeights?: Partial<EdgeScoreWeights>;
  },
): Promise<FillCandidate[]> {
  const legs = await listModelCandidateLegs(gameId);
  const historyByKey =
    userId != null ? (await getPlayerBettingRecord(userId)).byKey : {};

  let pool = legs.map((leg) => {
    const band = bands.get(`${leg.playerId}:${leg.statType}`) ?? "unknown";
    const history =
      historyByKey[playerRecordKey(leg.playerName, leg.statType)] ?? null;
    return suggestedLegToFillCandidate(
      { ...leg, benchmark: band },
      band,
      history,
    );
  });

  const useEdge =
    opts?.edgePackage ?? isPortfolioEdgeScoreEnabled();
  if (!useEdge) return pool;

  const [prices, leaders] = await Promise.all([
    loadBookPricesForGame(gameId),
    loadLastGameLeadersMap(gameId),
  ]);

  pool = pool.map((c) => {
    const bookOdds =
      c.statType === "any"
        ? null
        : pickPrice(prices, c.playerId, c.statType, c.line);
    const leader =
      c.statType === "any"
        ? undefined
        : leaders.get(`${c.playerId}:${c.statType}`);
    return applyEdgePackageToCandidate(c, {
      bookOdds,
      leaderRank: leader?.rank ?? null,
      leaderLastValue: leader?.lastValue ?? null,
      weights: opts?.edgeWeights,
    });
  });

  return pool;
}

export function strategiesToSlots(
  ranked: {
    strategyKey: string;
    focus: string;
    legCount: number;
    tier: string;
  }[],
): TicketSlot[] {
  return ranked.map((s, i) => ({
    id: `${i}:${s.strategyKey}`,
    strategyKey: s.strategyKey,
    focus: s.focus,
    legCount: s.legCount,
    isFun: s.tier === "fun" || /:fun$|_fun$/i.test(s.strategyKey),
  }));
}

export function runPortfolioFill(
  slots: TicketSlot[],
  pool: FillCandidate[],
  mode: "greedy" | "draft",
  options?: FillOptions,
): FillResult {
  const opts =
    isPortfolioEdgeScoreEnabled() && mode === "draft"
      ? edgePackageFillOptions(options)
      : options;
  return mode === "draft"
    ? fillSnakeDraft(slots, pool, opts)
    : fillGreedy(slots, pool);
}

/**
 * Explicit fill for backtests — pass edgePackage true to force v2 rules
 * regardless of env flag.
 */
export function runPortfolioFillExplicit(
  slots: TicketSlot[],
  pool: FillCandidate[],
  mode: "greedy" | "draft",
  options?: FillOptions & { edgePackage?: boolean },
): FillResult {
  const { edgePackage, ...fillOpts } = options ?? {};
  const opts =
    edgePackage && mode === "draft"
      ? edgePackageFillOptions(fillOpts)
      : fillOpts;
  return mode === "draft"
    ? fillSnakeDraft(slots, pool, opts)
    : fillGreedy(slots, pool);
}

/** Metrics from any ticket-shaped legs (persisted book or fill result). */
export function metricsFromLegSets(
  tickets: {
    strategyKey: string;
    isFun?: boolean;
    legs: {
      playerId: number | null;
      playerName: string;
      team: string | null;
      statType: string;
    }[];
  }[],
): PortfolioMetrics {
  const filled: FilledTicket[] = tickets.map((t, i) => ({
    slotId: String(i),
    strategyKey: t.strategyKey,
    isFun: !!t.isFun || t.strategyKey.includes("fun"),
    legs: t.legs
      .filter((l) => l.playerId != null)
      .map((l) => {
        const family = resolveStatFamily(l.statType as FillCandidate["statType"]);
        return {
          playerId: l.playerId!,
          playerName: l.playerName,
          team: l.team ?? "?",
          statType: l.statType as FillCandidate["statType"],
          statFamily: family,
          line: 0,
          prediction: 0,
          confidence: 0.5,
          softScore: 50,
        };
      }),
  }));
  return computeMetrics(filled);
}

export function appearanceCounts(result: FillResult): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of result.tickets) {
    if (t.isFun) continue;
    for (const l of t.legs) {
      const k = exposureKey(l.playerId, l.statFamily);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}
