import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  bookmakerLines,
  players,
  playerGameFeatures,
  predictions,
  type StatType,
} from "@/db/schema";

// Build three risk-tiered same-game-multi suggestions from our own data.
// Deterministic + transparent: we score each candidate leg from the bookmaker
// line + odds and our model (prediction edge + recent hit rate), then assemble
// cautious / medium / high tiers. Claude adds the plain-English rationale
// separately (see lib/ai/explainMultis).

export type RiskTier = "cautious" | "medium" | "high";
export type StatFocus = StatType | "any";

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
}

export interface Suggestion {
  tier: RiskTier;
  legs: SuggestedLeg[];
  estOdds: number | null;
  avgConfidence: number;
  rationale?: string;
}

const TIER_SIZE: Record<RiskTier, number> = { cautious: 3, medium: 4, high: 6 };

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

async function candidateLegs(gameId: number, focus: StatFocus): Promise<SuggestedLeg[]> {
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

  const [lines, feats] = await Promise.all([
    db.select().from(bookmakerLines).where(eq(bookmakerLines.gameId, gameId)),
    db.select().from(playerGameFeatures).where(eq(playerGameFeatures.gameId, gameId)),
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
    legs.push({
      playerId: p.playerId,
      playerName: p.name,
      jumper: p.jumper,
      team: p.team,
      statType: p.statType,
      line,
      odds,
      prediction: p.value,
      edge,
      hitRate,
      confidence: confidenceOf(hitRate, edge, line),
    });
  }
  return legs;
}

function pickTier(all: SuggestedLeg[], tier: RiskTier, focus: StatFocus): Suggestion {
  let pool = all.filter((l) => l.odds != null);
  if (tier === "cautious") {
    pool = pool.filter((l) => l.edge > 0 && (l.hitRate ?? 0) >= 0.5);
    pool.sort((a, b) => b.confidence - a.confidence || (a.odds ?? 9) - (b.odds ?? 9));
  } else if (tier === "medium") {
    pool = pool.filter((l) => l.edge > 0);
    // Reward confidence with a nod to payout.
    pool.sort(
      (a, b) =>
        b.confidence + 0.15 * ((b.odds ?? 1) - 1) - (a.confidence + 0.15 * ((a.odds ?? 1) - 1)),
    );
  } else {
    // High risk: our model still has to like it a bit, then chase the payout.
    pool = pool.filter((l) => l.confidence >= 0.35);
    pool.sort((a, b) => (b.odds ?? 0) - (a.odds ?? 0));
  }

  const chosen: SuggestedLeg[] = [];
  const usedPlayers = new Set<number>();
  const usedStats = new Set<StatType>();
  for (const l of pool) {
    if (chosen.length >= TIER_SIZE[tier]) break;
    if (usedPlayers.has(l.playerId)) continue;
    // In "any" mode keep a multi readable: at most two stat types.
    if (focus === "any" && !usedStats.has(l.statType) && usedStats.size >= 2) continue;
    chosen.push(l);
    usedPlayers.add(l.playerId);
    usedStats.add(l.statType);
  }

  const estOdds =
    chosen.length > 0
      ? Math.round(chosen.reduce((p, l) => p * (l.odds ?? 1), 1) * 100) / 100
      : null;
  const avgConfidence =
    chosen.length > 0 ? chosen.reduce((s, l) => s + l.confidence, 0) / chosen.length : 0;

  return { tier, legs: chosen, estOdds, avgConfidence };
}

export async function buildSuggestions(
  gameId: number,
  focus: StatFocus = "any",
): Promise<Suggestion[]> {
  const legs = await candidateLegs(gameId, focus);
  return (["cautious", "medium", "high"] as RiskTier[]).map((t) =>
    pickTier(legs, t, focus),
  );
}
