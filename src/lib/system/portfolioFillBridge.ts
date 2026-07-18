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
  assembleSoftScore,
  bandSoftBonus,
  computeMetrics,
  exposureKey,
  fillGreedy,
  fillSnakeDraft,
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
    softScore: assembleSoftScore({
      confidence: leg.confidence,
      bandBonus: bandSoftBonus(band ?? leg.benchmark),
      historyHits: hits,
      historyBets: bets,
    }),
    historyHits: hits,
    historyBets: bets,
  };
}

/** Load model candidate pool + attach personal tape for soft-score. */
export async function loadFillPool(
  gameId: number,
  bands: GameBenchmarkMap,
  userId?: number | null,
): Promise<FillCandidate[]> {
  const legs = await listModelCandidateLegs(gameId);
  const historyByKey =
    userId != null ? (await getPlayerBettingRecord(userId)).byKey : {};

  return legs.map((leg) => {
    const band = bands.get(`${leg.playerId}:${leg.statType}`) ?? "unknown";
    const history = historyByKey[playerRecordKey(leg.playerName, leg.statType)] ?? null;
    return suggestedLegToFillCandidate({ ...leg, benchmark: band }, band, history);
  });
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
  return mode === "draft"
    ? fillSnakeDraft(slots, pool, options)
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
