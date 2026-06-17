import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  bookmakerLines,
  players,
  playerGameFeatures,
  predictions,
  type StatType,
} from "@/db/schema";
import { getPlayerBettingRecord, playerRecordKey } from "@/lib/data/bets";
import { getPlayerNews, type InjuryNews } from "@/lib/ingest/injuries";
import { DEFAULT_LEGS, MAX_LEGS, MIN_LEGS } from "./suggestLimits";

// Build risk-tiered same-game-multi suggestions from our own data, sized to
// however many legs the punter wants on one ticket (1-25). Deterministic +
// transparent: we score each candidate leg from the bookmaker line + odds and
// our model (prediction edge + recent hit rate), nudged by the punter's own
// betting history on that player + stat, then take the top N per tier. Claude
// adds the plain-English rationale separately (see lib/ai/explainMultis).

export type RiskTier = "cautious" | "medium" | "high";
export type StatFocus = StatType | "any";

export { MIN_LEGS, MAX_LEGS, DEFAULT_LEGS };

export interface SuggestedLeg {
  playerId: number;
  playerName: string;
  jumper: number | null;
  team: string;
  statType: StatType;
  line: number;
  odds: number | null;
  prediction: number;
  edge: number;
  hitRate: number | null;
  confidence: number;
  history: { hits: number; bets: number } | null; // your own past bets on this player + stat
  news: InjuryNews | null; // matched injury/team news ("test"/"managed" survive, "out" is dropped)
}

export interface Suggestion {
  tier: RiskTier;
  legs: SuggestedLeg[];
  estOdds: number | null;
  avgConfidence: number;
  rationale?: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function confidenceOf(hitRate: number | null, edge: number, line: number): number {
  const hr = hitRate ?? 0.5;
  // Full margin credit when the prediction clears the line by 15%+.
  const margin = clamp(edge / (0.15 * Math.max(line, 1)), 0, 1);
  return clamp(0.55 * hr + 0.45 * margin, 0, 1);
}

/**
 * Nudge model confidence toward the punter's own track record on this exact
 * player + stat — "remember" past results so the same call isn't repeated at
 * full confidence if it's missed before. Influence is capped and shrinks in
 * with sample size (1 prior bet barely moves it; 3+ moves it up to 30%).
 */
function withHistory(confidence: number, history: { hits: number; bets: number } | null): number {
  if (!history || history.bets === 0) return confidence;
  const weight = (0.3 * clamp(history.bets, 0, 3)) / 3;
  const personalHitRate = history.hits / history.bets;
  return clamp(confidence * (1 - weight) + personalHitRate * weight, 0, 1);
}

/**
 * How a coarse news status scales a leg's confidence. "out" players are dropped
 * entirely (never suggest someone ruled out); "test"/"managed" are heavily
 * discounted; "available" (named/returning) and no-news are left as-is.
 */
function newsMultiplier(news: InjuryNews | null): number {
  switch (news?.status) {
    case "out":
      return 0;
    case "test":
      return 0.55;
    case "managed":
      return 0.8;
    default:
      return 1;
  }
}

async function candidateLegs(
  gameId: number,
  focus: StatFocus,
  historyByKey: Record<string, { hits: number; bets: number }>,
): Promise<SuggestedLeg[]> {
  const preds = await db
    .select({
      playerId: predictions.playerId,
      name: players.name,
      jumper: players.jumper,
      team: players.team,
      statType: predictions.statType,
      value: predictions.predictedValue,
    })
    .from(predictions)
    .innerJoin(players, eq(predictions.playerId, players.id))
    .where(and(eq(predictions.gameId, gameId), eq(predictions.model, "C")));

  const roster = [
    ...new Map(
      preds.map((p) => [p.playerId, { id: p.playerId, name: p.name, team: p.team }]),
    ).values(),
  ];
  const [lines, feats, newsByPlayer] = await Promise.all([
    db.select().from(bookmakerLines).where(eq(bookmakerLines.gameId, gameId)),
    db.select().from(playerGameFeatures).where(eq(playerGameFeatures.gameId, gameId)),
    getPlayerNews(roster),
  ]);

  // Median line + median over-odds per (playerId, stat).
  const lineGroups = new Map<string, number[]>();
  const oddsGroups = new Map<string, number[]>();
  for (const l of lines) {
    if (l.playerId == null) continue;
    const k = `${l.playerId}:${l.statType}`;
    (lineGroups.get(k) ?? lineGroups.set(k, []).get(k)!).push(l.line);
    if (l.overOdds != null) {
      (oddsGroups.get(k) ?? oddsGroups.set(k, []).get(k)!).push(l.overOdds);
    }
  }
  const formByKey = new Map<string, number[]>();
  for (const f of feats) formByKey.set(`${f.playerId}:${f.statType}`, f.recentForm ?? []);

  const legs: SuggestedLeg[] = [];
  for (const p of preds) {
    if (focus !== "any" && p.statType !== focus) continue;
    const key = `${p.playerId}:${p.statType}`;
    const line = median(lineGroups.get(key) ?? []);
    if (line == null) continue;
    const odds = median(oddsGroups.get(key) ?? []);
    const form = formByKey.get(key) ?? [];
    const hitRate = form.length > 0 ? form.filter((v) => v > line).length / form.length : null;
    const edge = p.value - line;
    const history = historyByKey[playerRecordKey(p.name, p.statType)] ?? null;
    const news = newsByPlayer.get(p.playerId) ?? null;
    if (news?.status === "out") continue; // never suggest a ruled-out player
    const base = withHistory(confidenceOf(hitRate, edge, line), history);
    legs.push({
      playerId: p.playerId,
      playerName: p.name,
      jumper: p.jumper,
      team: p.team,
      statType: p.statType,
      line,
      odds: odds == null ? null : Math.round(odds * 100) / 100,
      prediction: p.value,
      edge,
      hitRate,
      confidence: clamp(base * newsMultiplier(news), 0, 1),
      history,
      news,
    });
  }
  return legs;
}

/** Greedily take up to n distinct-player legs from a sorted pool. */
function pickN(pool: SuggestedLeg[], n: number): SuggestedLeg[] {
  const out: SuggestedLeg[] = [];
  const used = new Set<number>();
  for (const l of pool) {
    if (out.length >= n) break;
    if (used.has(l.playerId)) continue;
    out.push(l);
    used.add(l.playerId);
  }
  return out;
}

function finalize(tier: RiskTier, legs: SuggestedLeg[]): Suggestion {
  const estOdds =
    legs.length > 0
      ? Math.round(legs.reduce((p, l) => p * (l.odds ?? 1), 1) * 100) / 100
      : null;
  const avgConfidence =
    legs.length > 0 ? legs.reduce((s, l) => s + l.confidence, 0) / legs.length : 0;
  return { tier, legs, estOdds, avgConfidence };
}

/** Blended score used by the "medium" tier: mostly confidence, some value tilt. */
function mediumScore(l: SuggestedLeg): number {
  const oddsNorm = clamp(((l.odds ?? 1) - 1) / 4, 0, 1);
  return 0.7 * l.confidence + 0.3 * oddsNorm;
}

// Build three risk tiers, each the top `legCount` distinct-player legs from
// its own sorted pool — so the punter picks both the ticket size (1-25) and
// the risk flavour independently:
//   cautious = sorted by model confidence (safest bankers first)
//   medium   = confidence blended with a value tilt toward better odds
//   high     = sorted by odds (the longest shots our model still likes)
export async function buildSuggestions(
  gameId: number,
  focus: StatFocus = "any",
  legCount: number = DEFAULT_LEGS,
  userId: number | null = null,
): Promise<Suggestion[]> {
  const n = clamp(Math.round(legCount), MIN_LEGS, MAX_LEGS);
  const historyByKey = userId != null ? (await getPlayerBettingRecord(userId)).byKey : {};
  const legs = await candidateLegs(gameId, focus, historyByKey);
  const positive = legs.filter((l) => l.odds != null && l.edge > 0);

  const byConfidence = [...positive].sort((a, b) => b.confidence - a.confidence);
  const byMedium = [...positive].sort((a, b) => mediumScore(b) - mediumScore(a));
  const byOdds = [...positive].sort((a, b) => (b.odds ?? 0) - (a.odds ?? 0));

  return [
    finalize("cautious", pickN(byConfidence, n)),
    finalize("medium", pickN(byMedium, n)),
    finalize("high", pickN(byOdds, n)),
  ];
}
