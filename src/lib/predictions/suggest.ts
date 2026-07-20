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
import {
  bandConfidenceMult,
  bandRank,
  isBettableBand,
  type BenchmarkBand,
  type GameBenchmarkMap,
} from "@/lib/data/leaders";
import { getEmergencyMatcher } from "@/lib/ingest/lineup";
import { getPlayerNews, type InjuryNews } from "@/lib/ingest/injuries";
import { clearProbability } from "./probability";
import { modelPropLine } from "./modelLine";
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
  seasonAvg: number | null; // season-long average for this stat (picker ranking)
  fantasyAvg: number | null; // recent AFL Fantasy average — proxy for player quality
  hitRate: number | null;
  confidence: number;
  history: { hits: number; bets: number } | null; // your own past bets on this player + stat
  news: InjuryNews | null; // matched injury/team news ("test"/"managed" survive, "out" is dropped)
  /** Recent per-game counts for this stat (most recent first) — for live chance updates. */
  recentForm: number[];
  /** Position-relative season band from /leaders (System book steering). */
  benchmark?: BenchmarkBand | "unknown";
}

export type SuggestOptions = {
  /**
   * When set, prefer Elite→Average players for this market and boost/demote
   * confidence by band. Used by AI helm / System book.
   */
  benchmarks?: GameBenchmarkMap;
};

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

/**
 * Line for the suggest picker: highest bookie rung the projection still clears,
 * otherwise our standard model rung. Never lock in a bookie price above the
 * projection — that was dropping high-fantasy players (e.g. a 116-fantasy mid
 * with a steep posted line) from the +edge pool entirely.
 */
/**
 * Goals: one loud bag (e.g. Stringer 7) must not chase 4+/5+ rungs.
 * Cap the target at floor(seasonAvg)+1 (avg 2.1 → max 3+ → line 2.5).
 */
export function capGoalsLine(
  line: number,
  seasonAvg: number | null | undefined,
): number {
  if (seasonAvg == null || !Number.isFinite(seasonAvg) || seasonAvg < 0) {
    return line;
  }
  const maxTarget = Math.max(1, Math.floor(seasonAvg) + 1);
  const maxLine = maxTarget - 0.5;
  return Math.min(line, maxLine);
}

function pickSuggestLine(
  rungs: number[],
  prediction: number,
  statType: StatType,
  seasonAvg?: number | null,
): number | null {
  const bookie = rungs.length > 0 ? chooseRung(rungs, prediction) : null;
  const model = modelPropLine(statType, prediction);
  let line: number | null = null;
  if (bookie != null && prediction > bookie) line = bookie;
  else if (model != null && prediction > model) line = model;
  else line = model ?? bookie;
  if (line == null) return null;
  if (statType === "goals") return capGoalsLine(line, seasonAvg);
  return line;
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
  const emergencies = await getEmergencyMatcher(gameId);

  const preds = await db
    .select({
      playerId: predictions.playerId,
      name: players.name,
      jumper: players.jumper,
      team: players.team,
      recentFantasyAvg: players.recentFantasyAvg,
      statType: predictions.statType,
      value: predictions.predictedValue,
    })
    .from(predictions)
    .innerJoin(players, eq(predictions.playerId, players.id))
    .where(and(eq(predictions.gameId, gameId), eq(predictions.model, "C")));

  // Drop emergencies even if an older predict run still has rows for them.
  const activePreds = preds.filter(
    (p) =>
      !emergencies.matches({
        name: p.name,
        team: p.team,
        jumper: p.jumper,
      }),
  );

  const roster = [
    ...new Map(
      activePreds.map((p) => [p.playerId, { id: p.playerId, name: p.name, team: p.team }]),
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
  const seasonAvgByKey = new Map<string, number | null>();
  for (const f of feats) {
    formByKey.set(`${f.playerId}:${f.statType}`, f.recentForm ?? []);
    seasonAvgByKey.set(`${f.playerId}:${f.statType}`, f.seasonAverage ?? null);
  }

  const legs: SuggestedLeg[] = [];
  for (const p of activePreds) {
    if (focus !== "any" && p.statType !== focus) continue;
    const key = `${p.playerId}:${p.statType}`;
    // No bookmaker prop for this player+stat (common now that the squad seed
    // comes from the free lineup screenshot rather than the paid Odds API) —
    // fall back to our own projection as the line, same floor convention as
    // the stat board's "AI pick". Odds stay null; the picker shows "—" and
    // the punter sets their own target.
    const rungs = [...(rungsByKey.get(key) ?? [])];
    const seasonAvg = seasonAvgByKey.get(key) ?? null;
    const bookieLine = rungs.length > 0 ? chooseRung(rungs, p.value) : null;
    const line = pickSuggestLine(rungs, p.value, p.statType, seasonAvg);
    if (line == null) continue;
    const odds =
      bookieLine != null && line === bookieLine && p.value > bookieLine
        ? median(oddsByRung.get(`${key}:${line}`) ?? [])
        : null;
    const form = formByKey.get(key) ?? [];
    const hitRate = form.length > 0 ? form.filter((v) => v > line).length / form.length : null;
    const edge = p.value - line;
    const history = historyByKey[playerRecordKey(p.name, p.statType)] ?? null;
    const news = newsByPlayer.get(p.playerId) ?? null;
    if (news?.status === "out") continue; // never suggest a ruled-out player
    // Confidence is now the modelled probability of clearing the line (shrunk
    // for small samples), not a raw recent hit-rate — so a one-game player
    // can't read as a near-certainty. Edge + hitRate are still stored for the
    // single-stat ranking and the card's display.
    const base = withHistory(clearProbability({ prediction: p.value, line, form }), history);
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
      seasonAvg,
      fantasyAvg: p.recentFantasyAvg,
      hitRate,
      confidence: clamp(base * newsMultiplier(news), 0, 1),
      history,
      news,
      recentForm: form,
    });
  }
  return legs;
}

/** Decimal odds implied by model confidence when no bookmaker price exists. */
function oddsFromConfidence(confidence: number): number | null {
  if (confidence <= 0) return null;
  const p = clamp(confidence, 0.03, 0.92);
  return Math.round((1 / p) * 100) / 100;
}

/** Attach model-estimated prices so lineup/AFL-Tables legs can form a multi. */
function withEstimatedOdds(legs: SuggestedLeg[]): SuggestedLeg[] {
  return legs.map((l) =>
    l.odds != null ? l : { ...l, odds: oddsFromConfidence(l.confidence) },
  );
}

/** Legs we can rank into a ticket (real bookie price or model estimate). */
function bettableLegs(legs: SuggestedLeg[]): SuggestedLeg[] {
  return withEstimatedOdds(legs).filter((l) => l.odds != null);
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

/**
 * One leg per player — their strongest market — then top N by fantasy + confidence.
 * Avoids flooding the ticket with weak marks/tackles "1+" legs on midfielders
 * when their disposals projection is the real bet.
 */
function pickBestPerPlayer(pool: SuggestedLeg[], n: number): SuggestedLeg[] {
  const positive = pool.filter((l) => l.edge > 0);
  const source = positive.length > 0 ? positive : pool;
  const maxFantasy = Math.max(0, ...source.map((l) => l.fantasyAvg ?? 0));
  const score = (l: SuggestedLeg) =>
    l.confidence + (maxFantasy > 0 ? 0.2 * ((l.fantasyAvg ?? 0) / maxFantasy) : 0);

  const bestByPlayer = new Map<number, SuggestedLeg>();
  for (const l of source) {
    const prev = bestByPlayer.get(l.playerId);
    if (!prev || score(l) > score(prev)) bestByPlayer.set(l.playerId, l);
  }

  const ranked = [...bestByPlayer.values()].sort(
    (a, b) =>
      bandRank(a.benchmark ?? "unknown") - bandRank(b.benchmark ?? "unknown") ||
      score(b) - score(a),
  );
  const out: SuggestedLeg[] = [];
  const usedLegs = new Set<string>();
  const legKey = (l: SuggestedLeg) => `${l.playerId}:${l.statType}`;

  for (const l of ranked) {
    if (out.length >= n) break;
    out.push(l);
    usedLegs.add(legKey(l));
  }

  // Bigger tickets: add a player's next-best market if we still need legs.
  if (out.length < n) {
    const rest = [...source]
      .filter((l) => !usedLegs.has(legKey(l)))
      .sort(
        (a, b) =>
          bandRank(a.benchmark ?? "unknown") -
            bandRank(b.benchmark ?? "unknown") || score(b) - score(a),
      );
    for (const l of rest) {
      if (out.length >= n) break;
      out.push(l);
      usedLegs.add(legKey(l));
    }
  }

  return out;
}

/** Attach /leaders bands and prefer Elite→Average when filling the ticket. */
function applyBenchmarks(
  legs: SuggestedLeg[],
  bands: GameBenchmarkMap,
): SuggestedLeg[] {
  return legs.map((l) => {
    const band = bands.get(`${l.playerId}:${l.statType}`) ?? "unknown";
    return {
      ...l,
      benchmark: band,
      confidence: clamp(l.confidence * bandConfidenceMult(band), 0, 1),
    };
  });
}

function rankForBenchmarks(legs: SuggestedLeg[]): SuggestedLeg[] {
  const preferred = legs.filter((l) =>
    isBettableBand(l.benchmark ?? "unknown"),
  );
  const rest = legs.filter((l) => !isBettableBand(l.benchmark ?? "unknown"));
  const byBandThenConf = (a: SuggestedLeg, b: SuggestedLeg) =>
    bandRank(a.benchmark ?? "unknown") - bandRank(b.benchmark ?? "unknown") ||
    b.confidence - a.confidence ||
    b.edge - a.edge;
  return [
    ...[...preferred].sort(byBandThenConf),
    ...[...rest].sort(byBandThenConf),
  ];
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
  opts?: SuggestOptions,
): Promise<Suggestion> {
  const n = clamp(Math.round(legCount), MIN_LEGS, MAX_LEGS);
  const historyByKey = userId != null ? (await getPlayerBettingRecord(userId)).byKey : {};
  let legs = bettableLegs(await candidateLegs(gameId, focus, historyByKey));

  if (legs.length === 0) {
    return finalize([]);
  }

  if (opts?.benchmarks && opts.benchmarks.size > 0) {
    legs = applyBenchmarks(legs, opts.benchmarks);
  }

  // "Any" spreads the ticket across all four markets (round-robin, best players
  // first) instead of a straight confidence ranking that floods with whichever
  // market scores easiest — see pickSpread. A single-stat focus has only one
  // market, so it keeps the straight ranking: +edge legs first, then top up.
  if (focus === "any") {
    return finalize(pickBestPerPlayer(legs, n));
  }

  // Within a single market, prefer legs the model rates over the line (+edge),
  // best confidence first. With benchmarks, Elite→Average outrank Below.
  const byConfidence = (ls: SuggestedLeg[]) =>
    opts?.benchmarks
      ? rankForBenchmarks(ls)
      : [...ls].sort((a, b) => b.confidence - a.confidence);
  const positive = byConfidence(legs.filter((l) => l.edge > 0));

  // Top up toward the requested leg count with the next-best legs when the
  // +edge pool is short: an efficient bookie market only leaves ~half the
  // propped players above their line, so asking for a 10-leg disposals multi
  // was silently returning just the 5 with an edge. The punter chose the leg
  // count (and thus the risk), so fill it when the game has the players —
  // these top-up legs carry a non-positive edge (shown per leg in the "why"
  // popup) rather than being dropped. Identical output to before whenever the
  // +edge pool already covers n.
  const rest = byConfidence(legs.filter((l) => l.edge <= 0));
  return finalize(pickN([...positive, ...rest], n));
}

/**
 * Every predicted leg for a game, across all stat types, best confidence
 * first — the picker behind "+ Add player". A real SGM is freeform once
 * you start editing it, so this deliberately isn't scoped to the active
 * focus tab: a punter building a "Goals" multi might still want to add a
 * Disposals leg for a player they like.
 *
 * Unlike `buildSuggestions`, this doesn't require a real bookmaker price —
 * a lineup-seeded player with no prop posted still has a model projection,
 * and the punter can pick their own target without needing a quoted line.
 * Those legs just show "—" for odds (see SuggestedMultis).
 */
export async function listCandidateLegs(
  gameId: number,
  userId: number | null = null,
): Promise<SuggestedLeg[]> {
  const historyByKey = userId != null ? (await getPlayerBettingRecord(userId)).byKey : {};
  const legs = await candidateLegs(gameId, "any", historyByKey);
  return withEstimatedOdds([...legs].sort((a, b) => b.confidence - a.confidence));
}

/**
 * Model-priced legs with no personal-history blend — for System book draft fill
 * (tape enters as a separate ±10 soft-score modifier in portfolioFill).
 */
export async function listModelCandidateLegs(
  gameId: number,
): Promise<SuggestedLeg[]> {
  const legs = await candidateLegs(gameId, "any", {});
  return withEstimatedOdds([...legs].sort((a, b) => b.confidence - a.confidence));
}
