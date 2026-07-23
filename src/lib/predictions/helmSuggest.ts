/**
 * Helm Suggest — personal multi seed restricted to Top 10 board shortlists.
 * Returns thinking + per-leg why so the punter can question / swap before log.
 */

import { lineTarget, targetLabel } from "@/lib/format";
import { clearProbability } from "@/lib/predictions/probability";
import {
  buildTop10Board,
  type Top10Row,
} from "@/lib/predictions/top10Board";
import type { StatFocus, SuggestedLeg } from "@/lib/predictions/suggest";
import {
  DEFAULT_LEGS,
  MAX_LEGS,
  MIN_LEGS,
} from "@/lib/predictions/suggestLimits";
import { explainMultis } from "@/lib/ai/explainMultis";
import type { StatType } from "@/db/schema";

export type HelmLegReason = {
  playerId: number;
  statType: StatType;
  why: string;
};

export type HelmSuggestion = {
  focus: StatFocus;
  legCount: number;
  legs: SuggestedLeg[];
  /** Overall helm thinking (template or Claude). */
  thinking: string;
  legReasons: HelmLegReason[];
  combinedChance: number | null;
  estOdds: number | null;
  avgConfidence: number;
  /** True when we had to top up from outside Top 10 to fill N. */
  usedFallback: boolean;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function withHistory(
  confidence: number,
  history: { hits: number; bets: number } | null,
): number {
  if (!history || history.bets === 0) return confidence;
  const weight = (0.3 * clamp(history.bets, 0, 3)) / 3;
  const personalHitRate = history.hits / history.bets;
  return clamp(confidence * (1 - weight) + personalHitRate * weight, 0, 1);
}

function newsMult(status: string | undefined): number {
  if (status === "out") return 0;
  if (status === "test") return 0.55;
  if (status === "managed") return 0.8;
  return 1;
}

/** Convert a Top 10 row into a suggest-shaped leg using the board line. */
export function top10RowToSuggestedLeg(row: Top10Row): SuggestedLeg {
  const base = clearProbability({
    prediction: row.prediction,
    line: row.line,
    form: row.recentForm ?? [],
  });
  const confidence = clamp(
    withHistory(base, row.history) * newsMult(row.news?.status),
    0,
    1,
  );
  const edge = row.prediction - row.line;
  return {
    playerId: row.playerId,
    playerName: row.playerName,
    jumper: row.jumper,
    team: row.team,
    statType: row.statType,
    line: row.line,
    odds: row.odds,
    prediction: row.prediction,
    edge,
    seasonAvg: row.seasonAvg,
    fantasyAvg: row.fantasyAvg,
    hitRate: null,
    confidence,
    history: row.history,
    news: row.news,
    recentForm: row.recentForm,
    benchmark: row.benchmark,
  };
}

function scoreLeg(l: SuggestedLeg, maxFantasy: number): number {
  const fantasyBoost =
    maxFantasy > 0 ? 0.2 * ((l.fantasyAvg ?? 0) / maxFantasy) : 0;
  return l.confidence + fantasyBoost;
}

function pickHelmLegs(pool: SuggestedLeg[], n: number, focus: StatFocus): SuggestedLeg[] {
  if (pool.length === 0 || n <= 0) return [];
  const maxFantasy = Math.max(0, ...pool.map((l) => l.fantasyAvg ?? 0));
  const byScore = (a: SuggestedLeg, b: SuggestedLeg) =>
    scoreLeg(b, maxFantasy) - scoreLeg(a, maxFantasy);

  if (focus !== "any") {
    return [...pool].sort(byScore).slice(0, n);
  }

  // Any: best market per player, then fill.
  const bestByPlayer = new Map<number, SuggestedLeg>();
  for (const l of [...pool].sort(byScore)) {
    const prev = bestByPlayer.get(l.playerId);
    if (!prev || scoreLeg(l, maxFantasy) > scoreLeg(prev, maxFantasy)) {
      bestByPlayer.set(l.playerId, l);
    }
  }
  const out = [...bestByPlayer.values()].sort(byScore).slice(0, n);
  if (out.length >= n) return out;

  const used = new Set(out.map((l) => `${l.playerId}:${l.statType}`));
  for (const l of [...pool].sort(byScore)) {
    if (out.length >= n) break;
    const k = `${l.playerId}:${l.statType}`;
    if (used.has(k)) continue;
    out.push(l);
    used.add(k);
  }
  return out;
}

function buildLegWhy(row: Top10Row | undefined, leg: SuggestedLeg): string {
  const parts: string[] = [];
  if (row) {
    parts.push(`Top10 #${row.rank} ${shortStat(row.statType)}`);
  } else {
    parts.push("Outside Top 10 (fill)");
  }
  if (leg.benchmark && leg.benchmark !== "unknown") {
    parts.push(
      leg.benchmark === "elite"
        ? "Elite"
        : leg.benchmark === "above"
          ? "Above avg"
          : leg.benchmark === "below"
            ? "Below avg"
            : "Average",
    );
  }
  if (leg.seasonAvg != null) {
    parts.push(`avg ${Math.round(leg.seasonAvg * 10) / 10}`);
  }
  parts.push(`${Math.round(leg.confidence * 100)}% model`);
  if (leg.odds != null) parts.push(`$${leg.odds.toFixed(2)}`);
  if (leg.history && leg.history.bets > 0) {
    parts.push(`you ${leg.history.hits}/${leg.history.bets}`);
  }
  parts.push(`line ${targetLabel(leg.line)}`);
  return parts.join(" · ");
}

function shortStat(s: StatType): string {
  switch (s) {
    case "disposals":
      return "Disp";
    case "marks":
      return "Marks";
    case "tackles":
      return "Tck";
    case "goals":
      return "Goals";
    default:
      return s;
  }
}

function templateThinking(
  focus: StatFocus,
  legs: SuggestedLeg[],
  usedFallback: boolean,
): string {
  if (legs.length === 0) {
    return "No Top 10 legs available — generate predictions and check the boards.";
  }
  const names = legs
    .slice(0, 3)
    .map((l) => l.playerName.split(" ").pop())
    .join(", ");
  const focusLabel = focus === "any" ? "mixed markets" : focus;
  const fillNote = usedFallback
    ? " Topped up outside the shortlist to hit the leg count."
    : "";
  return `Helm ranked ${legs.length} ${focusLabel} legs from Top 10 shortlists by model clear % (personal tape nudge, news discount). Leading names: ${names}.${fillNote}`;
}

/**
 * Build a personal Helm Suggest ticket from Top 10 boards.
 * Falls back to remaining board rows outside the requested focus only when
 * the focused shortlist can't fill N (Any never falls back outside Top 10).
 */
export async function buildHelmSuggestion(
  gameId: number,
  focus: StatFocus = "any",
  legCount: number = DEFAULT_LEGS,
  userId: number | null = null,
): Promise<HelmSuggestion> {
  const n = clamp(Math.round(legCount), MIN_LEGS, MAX_LEGS);
  const board = await buildTop10Board(gameId, userId);

  const allRows: Top10Row[] = [];
  for (const m of board.markets) {
    allRows.push(...m.home.rows, ...m.away.rows);
  }

  const rowByKey = new Map(
    allRows.map((r) => [`${r.playerId}:${r.statType}`, r] as const),
  );

  const focusedRows =
    focus === "any"
      ? allRows
      : allRows.filter((r) => r.statType === focus);

  let pool = focusedRows
    .map(top10RowToSuggestedLeg)
    .filter((l) => l.confidence > 0);

  let usedFallback = false;
  let picked = pickHelmLegs(pool, n, focus);

  if (picked.length < n && focus !== "any") {
    const used = new Set(picked.map((l) => `${l.playerId}:${l.statType}`));
    const extra = allRows
      .filter((r) => !used.has(`${r.playerId}:${r.statType}`))
      .map(top10RowToSuggestedLeg)
      .filter((l) => l.confidence > 0);
    const more = pickHelmLegs(extra, n - picked.length, "any");
    if (more.length > 0) {
      usedFallback = true;
      picked = [...picked, ...more];
    }
  }

  const suggestionShape = {
    legs: picked,
    estOdds:
      picked.every((l) => l.odds != null && l.odds > 1)
        ? picked.reduce((p, l) => p * (l.odds as number), 1)
        : null,
    avgConfidence:
      picked.length > 0
        ? picked.reduce((s, l) => s + l.confidence, 0) / picked.length
        : 0,
    combinedChance:
      picked.length > 0
        ? picked.reduce((p, l) => p * l.confidence, 1)
        : null,
  };

  const explained = await explainMultis(suggestionShape);
  const thinking =
    explained.rationale && explained.rationale.length > 0
      ? explained.rationale
      : templateThinking(focus, picked, usedFallback);

  const legReasons: HelmLegReason[] = picked.map((l) => ({
    playerId: l.playerId,
    statType: l.statType,
    why: buildLegWhy(rowByKey.get(`${l.playerId}:${l.statType}`), l),
  }));

  return {
    focus,
    legCount: n,
    legs: picked,
    thinking,
    legReasons,
    combinedChance: suggestionShape.combinedChance,
    estOdds: suggestionShape.estOdds,
    avgConfidence: suggestionShape.avgConfidence,
    usedFallback,
  };
}

/** Map helm legs onto Top 10 rows when present (for ticket UI). */
export function helmLegToTicketFields(leg: SuggestedLeg, row?: Top10Row) {
  return {
    playerId: leg.playerId,
    playerName: leg.playerName,
    jumper: leg.jumper ?? row?.jumper ?? null,
    team: leg.team,
    statType: leg.statType,
    line: leg.line,
    odds: leg.odds,
    prediction: leg.prediction,
    seasonAvg: leg.seasonAvg ?? row?.seasonAvg ?? null,
    lastGame: row?.lastGame ?? leg.recentForm[0] ?? null,
    recentForm: leg.recentForm,
    fantasyAvg: leg.fantasyAvg,
    benchmark: leg.benchmark ?? row?.benchmark ?? ("unknown" as const),
    reason: row?.reason ?? "",
    availableRungs: row?.availableRungs ?? [],
    history: leg.history,
    news: leg.news,
    target: lineTarget(leg.line),
    rank: row?.rank ?? 99,
  };
}
