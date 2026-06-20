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

// Build a same-game-multi suggestion from our own data, sized to however many
// legs the punter wants on one ticket (1-25). Deterministic + transparent: we
// score each candidate leg from the bookmaker line + odds and our model
// (prediction edge + recent hit rate), nudged by the punter's own betting
// history on that player + stat, then rank every eligible leg by confidence
// and take the top N. Risk isn't a separate tier to pick — it's just what
// happens to the combined chance as N grows (each added leg multiplies the
// modelled chance of the whole ticket landing further down). Claude adds the
// plain-English rationale separately (see lib/ai/explainMultis).

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
  legs: SuggestedLeg[];
  estOdds: number | null;
  avgConfidence: number;
  /** Modelled chance the whole ticket lands — product of each leg's confidence. */
  combinedChance: number | null;
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

/**
 * Pick which line to bet for a player from the ladder the bookie offers.
 * Bet the highest rung the projection still clears: it keeps the line (and so
 * the payout) as high as possible while leaving a positive edge.
 *
 * This is what lets goals (and the other over-only ladder markets) show up at
 * all. Goals are quoted as a ladder — 0.5, 1.5, 2.5… — and collapsing it to a
 * median put the line at ~1.5/2.5, above most forwards' projected goals, so
 * every goal leg looked like a negative-edge miss and was filtered out. Picking
 * the clearable rung surfaces them at a sensible line (e.g. the 0.5 "anytime
 * goalscorer" rung for a ~1-goal forward). Falls back to the lowest rung when
 * the projection clears none, so the leg still exists and is dropped downstream
 * by the edge>0 filter only if it genuinely has no edge.
 */
function chooseRung(rungs: number[], prediction: number): number | null {
  if (rungs.length === 0) return null;
  const sorted = [...rungs].sort((a, b) => a - b);
  const clearable = sorted.filter((r) => r < prediction);
  return clearable.length > 0 ? clearable[clearable.length - 1] : sorted[0];
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

  // A (playerId, stat) usually exposes a whole ladder of lines, not one — the
  // over-only marks/tackles/goals markets list 0.5, 1.5, 2.5… Collect the rungs
  // on offer plus the odds quoted for each exact rung, so a chosen line can be
  // paired with its real price instead of a meaningless median across the ladder.
  const rungsByKey = new Map<string, Set<number>>();
  const oddsByRung = new Map<string, number[]>(); // `${player}:${stat}:${line}` -> overOdds[]
  for (const l of lines) {
    if (l.playerId == null) continue;
    const k = `${l.playerId}:${l.statType}`;
    (rungsByKey.get(k) ?? rungsByKey.set(k, new Set()).get(k)!).add(l.line);
    if (l.overOdds != null) {
      const rk = `${k}:${l.line}`;
      (oddsByRung.get(rk) ?? oddsByRung.set(rk, []).get(rk)!).push(l.overOdds);
    }
  }
  const formByKey = new Map<string, number[]>();
  for (const f of feats) formByKey.set(`${f.playerId}:${f.statType}`, f.recentForm ?? []);

  const legs: SuggestedLeg[] = [];
  for (const p of preds) {
    if (focus !== "any" && p.statType !== focus) continue;
    const key = `${p.playerId}:${p.statType}`;
    const line = chooseRung([...(rungsByKey.get(key) ?? [])], p.value);
    if (line == null) continue;
    const odds = median(oddsByRung.get(`${key}:${line}`) ?? []);
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

/**
 * Greedily take up to n legs from a sorted pool, best first.
 *
 * Pass 1 keeps to one leg per player — the spread a small ticket wants, and
 * identical to the old behaviour whenever distinct players can fill n. Pass 2
 * only runs if that falls short, stacking a player's other markets (e.g.
 * disposals + marks + goals on the one player) to reach the requested count.
 * A real same-game multi allows several markets on the same player, just not
 * the same market twice — so we dedup by (player, stat), never repeating a leg.
 * This is what lets an "Any" ticket climb toward the 25-leg max; a single-stat
 * focus has one market per player so pass 2 finds nothing and it stays bounded
 * by how many players the bookie props for that stat.
 */
function pickN(pool: SuggestedLeg[], n: number): SuggestedLeg[] {
  const out: SuggestedLeg[] = [];
  const usedPlayers = new Set<number>();
  const usedLegs = new Set<string>();
  const legKey = (l: SuggestedLeg) => `${l.playerId}:${l.statType}`;

  for (const l of pool) {
    if (out.length >= n) break;
    if (usedPlayers.has(l.playerId)) continue;
    out.push(l);
    usedPlayers.add(l.playerId);
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

function finalize(legs: SuggestedLeg[]): Suggestion {
  const estOdds =
    legs.length > 0
      ? Math.round(legs.reduce((p, l) => p * (l.odds ?? 1), 1) * 100) / 100
      : null;
  const avgConfidence =
    legs.length > 0 ? legs.reduce((s, l) => s + l.confidence, 0) / legs.length : 0;
  const combinedChance =
    legs.length > 0 ? legs.reduce((p, l) => p * l.confidence, 1) : null;
  return { legs, estOdds, avgConfidence, combinedChance };
}

/** Build one ranked multi: the top `legCount` distinct-player legs by confidence. */
export async function buildSuggestions(
  gameId: number,
  focus: StatFocus = "any",
  legCount: number = DEFAULT_LEGS,
  userId: number | null = null,
): Promise<Suggestion> {
  const n = clamp(Math.round(legCount), MIN_LEGS, MAX_LEGS);
  const historyByKey = userId != null ? (await getPlayerBettingRecord(userId)).byKey : {};
  const legs = await candidateLegs(gameId, focus, historyByKey);

  // A leg is only bettable if we have a price for it. Within that, prefer legs
  // the model rates over the line (+edge), best confidence first.
  const byConfidence = (ls: SuggestedLeg[]) =>
    [...ls].sort((a, b) => b.confidence - a.confidence);
  const withOdds = legs.filter((l) => l.odds != null);
  const positive = byConfidence(withOdds.filter((l) => l.edge > 0));

  // Top up toward the requested leg count with the next-best legs when the
  // +edge pool is short: an efficient bookie market only leaves ~half the
  // propped players above their line, so asking for a 10-leg disposals multi
  // was silently returning just the 5 with an edge. The punter chose the leg
  // count (and thus the risk), so fill it when the game has the players —
  // these top-up legs carry a non-positive edge (shown per leg in the "why"
  // popup) rather than being dropped. Identical output to before whenever the
  // +edge pool already covers n.
  const rest = byConfidence(withOdds.filter((l) => l.edge <= 0));
  return finalize(pickN([...positive, ...rest], n));
}

/**
 * Every bettable leg for a game, across all stat types, best confidence
 * first — the picker behind "+ Add player". A real SGM is freeform once
 * you start editing it, so this deliberately isn't scoped to the active
 * focus tab: a punter building a "Goals" multi might still want to add a
 * Disposals leg for a player they like.
 */
export async function listCandidateLegs(
  gameId: number,
  userId: number | null = null,
): Promise<SuggestedLeg[]> {
  const historyByKey = userId != null ? (await getPlayerBettingRecord(userId)).byKey : {};
  const legs = await candidateLegs(gameId, "any", historyByKey);
  return legs
    .filter((l) => l.odds != null)
    .sort((a, b) => b.confidence - a.confidence);
}
