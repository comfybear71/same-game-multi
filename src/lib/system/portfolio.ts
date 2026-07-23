import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  games,
  playerGameFeatures,
  systemTicketLegs,
  systemTickets,
  type StatType,
} from "@/db/schema";
import { BACKTEST_STRATEGIES } from "@/lib/backtest/matrix";
import {
  getGameBenchmarkBands,
  type BenchmarkBand,
  type PositionBucket,
} from "@/lib/data/leaders";
import { minLineTarget } from "@/lib/predictions/modelLine";
import { clearProbability } from "@/lib/predictions/probability";
import {
  buildSuggestions,
  type StatFocus,
  type SuggestedLeg,
} from "@/lib/predictions/suggest";
import { setLineupPlayerStatus } from "@/lib/ingest/lineup";
import { computeCashReturn } from "@/lib/system/cash";
import {
  loadMatchupPlaybook,
  notesToWeights,
  rankStrategiesForMatchup,
  type MatchupPlaybook,
  type PlaybookNote,
} from "@/lib/system/playbook";
import {
  ensureActivePolicy,
  getActivePolicy,
  PORTFOLIO_K,
  type ActivePolicyView,
} from "@/lib/system/policy";
import { modelEdge, impliedProbability } from "@/lib/system/edgeScore";
import { loadLastGameLeadersMap } from "@/lib/system/lastGameLeadersDb";
import { loadBookPricesForGame, pickPrice } from "@/lib/system/oddsPrices";
import {
  isPortfolioDraftFillEnabled,
  isPortfolioEdgeScoreEnabled,
  resolveStatFamily,
  type PortfolioMetrics,
} from "@/lib/system/portfolioFill";
import {
  buildChooserBook,
  materialiseSelections,
  type CardStyle,
  type ChooserBook,
} from "@/lib/system/chooser";
import {
  loadFillPool,
  metricsFromLegSets,
  runPortfolioFill,
  strategiesToSlots,
} from "@/lib/system/portfolioFillBridge";
import { top10RankMap } from "@/lib/predictions/top10Board";

export { computeCashReturn };
export type { PortfolioMetrics };

/**
 * Mark a player emergency on the lineup, clear their predictions, rebuild book.
 * Used when Claude mis-tags an emergency and they show up in a System ticket.
 */
export async function excludePlayerFromSystemBook(
  gameId: number,
  playerName: string,
  team?: string | null,
): Promise<SystemTicketView[]> {
  const { updated } = await setLineupPlayerStatus(
    gameId,
    playerName,
    "emergency",
    team,
  );
  if (updated === 0) {
    throw new Error(`"${playerName}" not found in this game's lineup`);
  }
  return buildAndPersistSystemPortfolio(gameId);
}

export type LegEdgeBadge = {
  /** Positive = +EV (green); negative = taxed (red). */
  edge: number;
  modelPct: number;
  impliedPct: number;
};

export type LegHotBadge = {
  rank: number;
  lastValue: number;
  /** e.g. "5 goals last wk" */
  label: string;
};

export interface SystemTicketView {
  id: number;
  gameId: number;
  strategyKey: string;
  focus: string;
  legCount: number;
  tier: string;
  label: string;
  /** Plain-English ticket story (playbook / FUN / Any). */
  why?: string | null;
  modelledChance: number | null;
  estOdds: number | null;
  placedOdds: number | null;
  stake: number | null;
  legsHit: number;
  legsTotal: number;
  slipHit: boolean | null;
  voided: boolean;
  flatReturn: number;
  cashReturn: number;
  gradedAt: Date | null;
  legs: {
    id: number;
    playerId: number | null;
    playerName: string;
    team: string | null;
    statType: StatType;
    line: number;
    prediction: number;
    confidence: number;
    actualValue: number | null;
    hit: boolean | null;
    voided: boolean;
    /** Leaders stamp — position / season avg / Elite→Below. */
    position?: PositionBucket | null;
    seasonAvg?: number | null;
    benchmark?: BenchmarkBand | "unknown" | null;
    percentile?: number | null;
    /** Present when PORTFOLIO_EDGE_SCORE on and a bookie price exists. */
    edgeBadge?: LegEdgeBadge | null;
    /** Present when PORTFOLIO_EDGE_SCORE on and player was top-3 last game. */
    hotBadge?: LegHotBadge | null;
    /** Why this leg made the System cut (Top10 rank, appearances, etc.). */
    legWhy?: string | null;
  }[];
}

export type SystemBookResponse = {
  tickets: SystemTicketView[];
  metrics: PortfolioMetrics;
  draftFillEnabled: boolean;
  edgeScoreEnabled: boolean;
  chooser?: ChooserBook | null;
  selections?: Record<string, CardStyle>;
};

export type { CardStyle, ChooserBook };

function hotLabel(statType: StatType, lastValue: number): string {
  const n = Number.isInteger(lastValue)
    ? String(lastValue)
    : lastValue.toFixed(1);
  return `${n} ${statType} last wk`;
}

function bookMetricsFromViews(tickets: SystemTicketView[]): PortfolioMetrics {
  return metricsFromLegSets(
    tickets.map((t) => ({
      strategyKey: t.strategyKey,
      isFun: t.tier === "fun",
      legs: t.legs,
    })),
  );
}

async function attachEdgeHotBadges(
  gameId: number,
  tickets: SystemTicketView[],
): Promise<SystemTicketView[]> {
  if (!isPortfolioEdgeScoreEnabled() || tickets.length === 0) return tickets;

  const [prices, leaders] = await Promise.all([
    loadBookPricesForGame(gameId),
    loadLastGameLeadersMap(gameId),
  ]);

  return tickets.map((t) => ({
    ...t,
    legs: t.legs.map((l) => {
      let edgeBadge: LegEdgeBadge | null = null;
      let hotBadge: LegHotBadge | null = null;
      if (l.playerId != null) {
        const odds = pickPrice(prices, l.playerId, l.statType, l.line);
        const edge = modelEdge(l.confidence, odds);
        if (edge != null && odds != null) {
          edgeBadge = {
            edge,
            modelPct: l.confidence,
            impliedPct: impliedProbability(odds),
          };
        }
        const leader = leaders.get(`${l.playerId}:${l.statType}`);
        if (leader) {
          hotBadge = {
            rank: leader.rank,
            lastValue: leader.lastValue,
            label: hotLabel(l.statType, leader.lastValue),
          };
        }
      }
      return { ...l, edgeBadge, hotBadge };
    }),
  }));
}

export async function getSystemBookResponse(
  gameId: number,
): Promise<SystemBookResponse> {
  const base = await getSystemBook(gameId);
  const withBadges = await attachEdgeHotBadges(gameId, base);
  const tickets = await attachSystemWhy(gameId, withBadges);
  return {
    tickets,
    metrics: bookMetricsFromViews(tickets),
    draftFillEnabled: isPortfolioDraftFillEnabled(),
    edgeScoreEnabled: isPortfolioEdgeScoreEnabled(),
  };
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

function ticketWhyBlurb(t: SystemTicketView): string {
  if (t.tier === "fun") {
    return "FUN flutter — long Any lottery (≥10 legs), core-free leftovers the draft passed. Hedge against the book being wrong.";
  }
  if (t.focus === "any") {
    return "Any banker — mixed markets from the Lab/H2H playbook. Snake-drafted with appearance caps so elites aren't cloned across every ticket.";
  }
  const focus = t.focus.charAt(0).toUpperCase() + t.focus.slice(1);
  return `${focus} · ${t.legCount} legs — Lab recipe slot. Prefer Top 10 shortlist names; diversify via draft penalties / satellite rules.`;
}

/** Attach ticket + per-leg why from Top 10 ranks and book appearance counts. */
export async function attachSystemWhy(
  gameId: number,
  tickets: SystemTicketView[],
): Promise<SystemTicketView[]> {
  if (tickets.length === 0) return tickets;

  let ranks = new Map<
    string,
    { rank: number; team: string; line: number; seasonAvg: number | null }
  >();
  try {
    ranks = await top10RankMap(gameId);
  } catch {
    ranks = new Map();
  }

  const apps = new Map<string, number>();
  for (const t of tickets) {
    if (t.tier === "fun") continue;
    for (const l of t.legs) {
      if (l.playerId == null) continue;
      const family = resolveStatFamily(l.statType);
      const k = `${l.playerId}:${family}`;
      apps.set(k, (apps.get(k) ?? 0) + 1);
    }
  }

  return tickets.map((t) => ({
    ...t,
    why: t.why ?? ticketWhyBlurb(t),
    legs: t.legs.map((l) => {
      const parts: string[] = [];
      if (l.playerId != null) {
        const top = ranks.get(`${l.playerId}:${l.statType}`);
        if (top) {
          parts.push(`Top10 #${top.rank} ${shortStat(l.statType)}`);
        } else {
          parts.push(`Outside Top 10 ${shortStat(l.statType)}`);
        }
        const family = resolveStatFamily(l.statType);
        const n = apps.get(`${l.playerId}:${family}`) ?? 0;
        if (n > 1 && t.tier !== "fun") {
          parts.push(`${n}× in book`);
        } else if (n === 1 && t.tier !== "fun") {
          parts.push("1st in book");
        }
      }
      if (l.benchmark && l.benchmark !== "unknown") {
        parts.push(
          l.benchmark === "elite"
            ? "Elite"
            : l.benchmark === "above"
              ? "Above"
              : l.benchmark === "below"
                ? "Below"
                : "Avg",
        );
      }
      if (l.seasonAvg != null) {
        parts.push(`avg ${Math.round(l.seasonAvg * 10) / 10}`);
      }
      parts.push(`${Math.round(l.confidence * 100)}% model`);
      if (l.edgeBadge) {
        const e = Math.round(l.edgeBadge.edge * 1000) / 10;
        parts.push(e >= 0 ? `edge +${e}%` : `taxed ${e}%`);
      }
      if (l.hotBadge) parts.push(`HOT ${l.hotBadge.label}`);
      return { ...l, legWhy: parts.join(" · ") };
    }),
  }));
}

/** Label from strategy key; prefer actual filled leg count when known. */
function strategyLabel(key: string, actualLegs?: number): string {
  const known = BACKTEST_STRATEGIES.find((s) => s.key === key)?.label;
  if (known && actualLegs == null) return known;
  const m = key.match(/^([a-z]+)_(\d+)$/i);
  if (!m) {
    if (known && actualLegs != null) {
      return known.replace(/\d+\s*legs?/i, `${actualLegs} legs`);
    }
    return key;
  }
  const focus = m[1]!;
  const legs = actualLegs ?? Number(m[2]!);
  const title = focus.charAt(0).toUpperCase() + focus.slice(1);
  return `${title} · ${legs} legs`;
}

export type SystemPortfolioPreview = {
  gameId: number;
  home: string;
  away: string;
  persisted: false;
  playbook: {
    meetings: number;
    sourceRunId: number | null;
    sourceLabel: string | null;
  } | null;
  recipes: PlaybookNote[];
  metrics: PortfolioMetrics;
  draftFillEnabled: boolean;
  tickets: {
    strategyKey: string;
    label: string;
    focus: string;
    legCount: number;
    tier: string;
    why: string;
    h2hHitRate: number | null;
    h2hRoi: number | null;
    h2hSlips: number;
    modelledChance: number | null;
    estOdds: number | null;
    legs: {
      playerId: number | null;
      playerName: string;
      team: string | null;
      statType: StatType;
      line: number;
      prediction: number;
      confidence: number;
      benchmark?: BenchmarkBand | "unknown";
    }[];
  }[];
};

async function resolveGameSides(
  gameId: number,
): Promise<{ home: string; away: string } | null> {
  const [row] = await db
    .select({ home: games.home, away: games.away })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  return row ?? null;
}

async function selectStrategiesForGame(
  gameId: number,
  policy: ActivePolicyView,
  k: number,
): Promise<{
  ranked: ReturnType<typeof notesToWeights>;
  notes: PlaybookNote[];
  playbook: MatchupPlaybook | null;
  home: string;
  away: string;
}> {
  const sides = await resolveGameSides(gameId);
  if (!sides) throw new Error(`Game ${gameId} not found`);

  const playbook = await loadMatchupPlaybook(
    sides.home,
    sides.away,
    policy.sourceRunId,
  );
  const { selected } = rankStrategiesForMatchup(policy, playbook, k);
  return {
    ranked: notesToWeights(selected),
    notes: selected,
    playbook,
    home: sides.home,
    away: sides.away,
  };
}

/**
 * Dry-run System book: H2H Lab playbook + suggestions, no DB writes.
 */
export async function previewSystemPortfolio(
  gameId: number,
  opts?: { policy?: ActivePolicyView; k?: number; userId?: number | null },
): Promise<SystemPortfolioPreview> {
  const policy = opts?.policy ?? (await ensureActivePolicy());
  const k = opts?.k ?? PORTFOLIO_K;
  const { ranked, notes, playbook, home, away } = await selectStrategiesForGame(
    gameId,
    policy,
    k,
  );

  const noteByKey = new Map(notes.map((n) => [n.strategyKey, n]));
  const { bands } = await getGameBenchmarkBands(gameId);
  const tickets: SystemPortfolioPreview["tickets"] = [];
  const useDraft = isPortfolioDraftFillEnabled();

  if (useDraft) {
    const pool = await loadFillPool(gameId, bands, opts?.userId ?? null);
    const slots = strategiesToSlots(ranked);
    const filled = runPortfolioFill(slots, pool, "draft");
    for (const t of filled.tickets) {
      if (t.legs.length === 0) continue;
      const note = noteByKey.get(t.strategyKey);
      const strat = ranked.find((s) => s.strategyKey === t.strategyKey);
      const { combinedChance, estOdds } = modelStatsFromLegs(t.legs);
      tickets.push({
        strategyKey: t.strategyKey,
        label: note?.label
          ? note.label.replace(/\d+\s*legs?/i, `${t.legs.length} legs`)
          : strategyLabel(t.strategyKey, t.legs.length),
        focus: strat?.focus ?? "any",
        legCount: t.legs.length,
        tier: t.isFun ? "fun" : (note?.tier ?? strat?.tier ?? "balanced"),
        why: note?.why ?? "Global helm",
        h2hHitRate: note?.h2hHitRate ?? null,
        h2hRoi: note?.h2hRoi ?? null,
        h2hSlips: note?.h2hSlips ?? 0,
        modelledChance: combinedChance,
        estOdds,
        legs: t.legs.map((l) => ({
          playerId: l.playerId,
          playerName: l.playerName,
          team: l.team,
          statType: l.statType as StatType,
          line: l.line,
          prediction: l.prediction,
          confidence: l.confidence,
          benchmark: bands.get(`${l.playerId}:${l.statType}`) ?? undefined,
        })),
      });
    }
  } else {
    for (const strat of ranked) {
      const focus = strat.focus as StatFocus;
      const suggestion = await buildSuggestions(
        gameId,
        focus,
        strat.legCount,
        opts?.userId ?? null,
        { benchmarks: bands },
      );
      if (suggestion.legs.length === 0) continue;
      const note = noteByKey.get(strat.strategyKey);
      tickets.push({
        strategyKey: strat.strategyKey,
        label: note?.label
          ? note.label.replace(
              /\d+\s*legs?/i,
              `${suggestion.legs.length} legs`,
            )
          : strategyLabel(strat.strategyKey, suggestion.legs.length),
        focus: strat.focus,
        legCount: suggestion.legs.length,
        tier: note?.tier ?? strat.tier,
        why: note?.why ?? "Global helm",
        h2hHitRate: note?.h2hHitRate ?? null,
        h2hRoi: note?.h2hRoi ?? null,
        h2hSlips: note?.h2hSlips ?? 0,
        modelledChance: suggestion.combinedChance,
        estOdds: suggestion.estOdds,
        legs: suggestion.legs.map((l) => ({
          playerId: l.playerId,
          playerName: l.playerName,
          team: l.team,
          statType: l.statType,
          line: l.line,
          prediction: l.prediction,
          confidence: l.confidence,
          benchmark: l.benchmark,
        })),
      });
    }
  }

  return {
    gameId,
    home,
    away,
    persisted: false,
    playbook: playbook
      ? {
          meetings: playbook.meetings,
          sourceRunId: playbook.sourceRunId,
          sourceLabel: playbook.sourceLabel,
        }
      : null,
    recipes: notes,
    metrics: metricsFromLegSets(
      tickets.map((t) => ({
        strategyKey: t.strategyKey,
        isFun: t.tier === "fun",
        legs: t.legs,
      })),
    ),
    draftFillEnabled: useDraft,
    tickets,
  };
}

/** Load persisted system tickets for a game. */
export async function getSystemBook(gameId: number): Promise<SystemTicketView[]> {
  const tickets = await db
    .select()
    .from(systemTickets)
    .where(eq(systemTickets.gameId, gameId));
  if (tickets.length === 0) return [];

  const legs = await db
    .select()
    .from(systemTicketLegs)
    .where(
      inArray(
        systemTicketLegs.ticketId,
        tickets.map((t) => t.id),
      ),
    );

  const byTicket = new Map<number, typeof legs>();
  for (const leg of legs) {
    const list = byTicket.get(leg.ticketId) ?? [];
    list.push(leg);
    byTicket.set(leg.ticketId, list);
  }

  const policy = await getActivePolicy();
  const tierByKey = new Map(
    (policy?.weights.strategies ?? []).map((s) => [s.strategyKey, s.tier]),
  );

  const { details } = await getGameBenchmarkBands(gameId);

  return tickets
    .map((t) => ({
      id: t.id,
      gameId: t.gameId,
      strategyKey: t.strategyKey,
      focus: t.focus,
      legCount: t.legCount,
      tier: t.tier || tierByKey.get(t.strategyKey) || "balanced",
      label: strategyLabel(
        t.strategyKey,
        (byTicket.get(t.id) ?? []).length || t.legCount,
      ),
      modelledChance: t.modelledChance,
      estOdds: t.estOdds,
      placedOdds: t.placedOdds,
      stake: t.stake,
      legsHit: t.legsHit,
      legsTotal: t.legsTotal,
      slipHit: t.slipHit,
      voided: t.voided,
      flatReturn: t.flatReturn,
      cashReturn: t.cashReturn,
      gradedAt: t.gradedAt,
      legs: (byTicket.get(t.id) ?? []).map((l) => {
        let stamp =
          l.playerId != null
            ? details.get(`${l.playerId}:${l.statType}`)
            : undefined;
        if (!stamp) {
          for (const [key, row] of details) {
            if (
              key.endsWith(`:${l.statType}`) &&
              row.playerName === l.playerName
            ) {
              stamp = row;
              break;
            }
          }
        }
        return {
          id: l.id,
          playerId: l.playerId,
          playerName: l.playerName,
          team: stamp?.team ?? l.team,
          statType: l.statType,
          line: l.line,
          prediction: l.prediction,
          confidence: l.confidence,
          actualValue: l.actualValue,
          hit: l.hit,
          voided: l.voided,
          position: stamp?.position ?? null,
          seasonAvg: stamp?.average ?? null,
          benchmark: stamp?.band ?? null,
          percentile: stamp?.percentile ?? null,
        };
      }),
    }))
    .sort((a, b) => {
      // FUN flutter always last in the book.
      if (a.tier === "fun" && b.tier !== "fun") return 1;
      if (b.tier === "fun" && a.tier !== "fun") return -1;
      const order = {
        banker: 0,
        balanced: 1,
        low: 2,
        fun: 3,
      } as Record<string, number>;
      return (
        (order[a.tier] ?? 9) - (order[b.tier] ?? 9) ||
        a.strategyKey.localeCompare(b.strategyKey)
      );
    });
}

/**
 * Save bookie odds + stake on a system ticket. Recomputes cashReturn if already graded.
 */
export async function updateSystemTicketPlacement(
  ticketId: number,
  opts: { stake?: number | null; placedOdds?: number | null },
): Promise<SystemTicketView | null> {
  const [existing] = await db
    .select()
    .from(systemTickets)
    .where(eq(systemTickets.id, ticketId))
    .limit(1);
  if (!existing) return null;

  const stake =
    opts.stake !== undefined
      ? opts.stake == null || Number.isNaN(opts.stake)
        ? null
        : opts.stake
      : existing.stake;
  const placedOdds =
    opts.placedOdds !== undefined
      ? opts.placedOdds == null || Number.isNaN(opts.placedOdds)
        ? null
        : opts.placedOdds
      : existing.placedOdds;

  if (stake != null && stake < 0) {
    throw new Error("Stake must be ≥ 0");
  }
  if (placedOdds != null && placedOdds <= 1) {
    throw new Error("Placed odds must be greater than 1.00");
  }

  const cashReturn = computeCashReturn(
    existing.slipHit,
    stake,
    placedOdds,
    existing.voided,
  );

  await db
    .update(systemTickets)
    .set({ stake, placedOdds, cashReturn })
    .where(eq(systemTickets.id, ticketId));

  const book = await getSystemBookResponse(existing.gameId);
  return book.tickets.find((t) => t.id === ticketId) ?? null;
}

/**
 * Nudge a System book leg to a Sportsbet whole-number target (e.g. 2+ tackles).
 * Recalculates leg confidence + ticket model chance / est odds. Blocked once graded.
 */
export async function updateSystemTicketLegTarget(
  legId: number,
  target: number,
): Promise<SystemTicketView | null> {
  if (!Number.isFinite(target) || target < 1) {
    throw new Error("Target must be a whole number ≥ 1");
  }
  const whole = Math.floor(target);

  const [leg] = await db
    .select()
    .from(systemTicketLegs)
    .where(eq(systemTicketLegs.id, legId))
    .limit(1);
  if (!leg) return null;

  const [ticket] = await db
    .select()
    .from(systemTickets)
    .where(eq(systemTickets.id, leg.ticketId))
    .limit(1);
  if (!ticket) return null;
  if (ticket.gradedAt != null || ticket.slipHit != null) {
    throw new Error("Can't edit lines after the ticket is graded");
  }

  const floor = minLineTarget(leg.statType);
  if (whole < floor) {
    throw new Error(`${leg.statType} target must be ≥ ${floor}+`);
  }

  let form: number[] = [];
  if (leg.playerId != null) {
    const [feat] = await db
      .select({ recentForm: playerGameFeatures.recentForm })
      .from(playerGameFeatures)
      .where(
        and(
          eq(playerGameFeatures.playerId, leg.playerId),
          eq(playerGameFeatures.gameId, ticket.gameId),
          eq(playerGameFeatures.statType, leg.statType),
        ),
      )
      .limit(1);
    form = feat?.recentForm ?? [];
  }

  const line = whole - 0.5;
  const confidence = clearProbability({
    prediction: leg.prediction,
    line,
    form,
  });

  await db
    .update(systemTicketLegs)
    .set({ line, confidence })
    .where(eq(systemTicketLegs.id, legId));

  const legs = await db
    .select()
    .from(systemTicketLegs)
    .where(eq(systemTicketLegs.ticketId, ticket.id));

  const combinedChance =
    legs.length > 0 ? legs.reduce((p, l) => p * l.confidence, 1) : null;
  // Model odds from implied leg probs (no bookie quote) — punter still enters placedOdds.
  const estOdds =
    legs.length > 0
      ? Math.round(
          legs.reduce((p, l) => p * (1 / Math.max(l.confidence, 0.05)), 1) * 100,
        ) / 100
      : null;

  await db
    .update(systemTickets)
    .set({
      modelledChance: combinedChance,
      estOdds,
      cashReturn: computeCashReturn(
        ticket.slipHit,
        ticket.stake,
        ticket.placedOdds,
        ticket.voided,
      ),
    })
    .where(eq(systemTickets.id, ticket.id));

  const book = await getSystemBookResponse(ticket.gameId);
  return book.tickets.find((t) => t.id === ticket.id) ?? null;
}

export type SwapLegInput = {
  playerId: number;
  playerName: string;
  team: string | null;
  statType: StatType;
  line: number;
  prediction: number;
  confidence?: number;
};

export type SwapLegResult = {
  ticket: SystemTicketView;
  warnings: string[];
};

/**
 * Replace a System book leg with another player×market before lock/grade.
 * Warns on clone / team-cap pressure; does not hard-block (punter can override).
 */
export async function swapSystemTicketLeg(
  legId: number,
  next: SwapLegInput,
): Promise<SwapLegResult | null> {
  const [leg] = await db
    .select()
    .from(systemTicketLegs)
    .where(eq(systemTicketLegs.id, legId))
    .limit(1);
  if (!leg) return null;

  const [ticket] = await db
    .select()
    .from(systemTickets)
    .where(eq(systemTickets.id, leg.ticketId))
    .limit(1);
  if (!ticket) return null;
  if (ticket.gradedAt != null || ticket.slipHit != null) {
    throw new Error("Can't swap legs after the ticket is graded");
  }
  if (ticket.stake != null && ticket.placedOdds != null) {
    throw new Error("Unlock stake/odds first — ticket is locked");
  }

  const warnings: string[] = [];
  const siblings = await db
    .select()
    .from(systemTicketLegs)
    .where(eq(systemTicketLegs.ticketId, ticket.id));

  const sameOnTicket = siblings.some(
    (s) =>
      s.id !== legId &&
      s.playerId === next.playerId &&
      s.statType === next.statType,
  );
  if (sameOnTicket) {
    warnings.push("Same player×market already on this ticket");
  }

  const team = next.team ?? "?";
  const otherTeams = siblings
    .filter((s) => s.id !== legId)
    .map((s) => s.team ?? "?");
  const teamCount = otherTeams.filter((t) => t === team).length + 1;
  const cap = Math.ceil(siblings.length * 0.5);
  if (teamCount > cap) {
    warnings.push(
      `Team lean warning: ${teamCount}/${siblings.length} legs from ${team} (soft cap ~${cap})`,
    );
  }

  // Book-wide clone warning (non-FUN)
  if (ticket.tier !== "fun") {
    const book = await getSystemBook(ticket.gameId);
    let apps = 0;
    for (const t of book) {
      if (t.tier === "fun" || t.id === ticket.id) continue;
      for (const l of t.legs) {
        if (l.playerId === next.playerId && l.statType === next.statType) {
          apps += 1;
        }
      }
    }
    if (apps >= 1) {
      warnings.push(
        `Already on ${apps} other non-FUN ticket(s) — anti-clone diversification`,
      );
    }
  }

  let form: number[] = [];
  const [feat] = await db
    .select({ recentForm: playerGameFeatures.recentForm })
    .from(playerGameFeatures)
    .where(
      and(
        eq(playerGameFeatures.playerId, next.playerId),
        eq(playerGameFeatures.gameId, ticket.gameId),
        eq(playerGameFeatures.statType, next.statType),
      ),
    )
    .limit(1);
  form = feat?.recentForm ?? [];

  const confidence =
    next.confidence != null && Number.isFinite(next.confidence)
      ? next.confidence
      : clearProbability({
          prediction: next.prediction,
          line: next.line,
          form,
        });

  await db
    .update(systemTicketLegs)
    .set({
      playerId: next.playerId,
      playerName: next.playerName,
      team: next.team,
      statType: next.statType,
      line: next.line,
      prediction: next.prediction,
      confidence,
    })
    .where(eq(systemTicketLegs.id, legId));

  const legs = await db
    .select()
    .from(systemTicketLegs)
    .where(eq(systemTicketLegs.ticketId, ticket.id));

  const combinedChance =
    legs.length > 0 ? legs.reduce((p, l) => p * l.confidence, 1) : null;
  const estOdds =
    legs.length > 0
      ? Math.round(
          legs.reduce((p, l) => p * (1 / Math.max(l.confidence, 0.05)), 1) *
            100,
        ) / 100
      : null;

  await db
    .update(systemTickets)
    .set({ modelledChance: combinedChance, estOdds })
    .where(eq(systemTickets.id, ticket.id));

  const refreshed = await getSystemBookResponse(ticket.gameId);
  const view = refreshed.tickets.find((t) => t.id === ticket.id);
  if (!view) return null;
  return { ticket: view, warnings };
}

function modelStatsFromLegs(
  legs: { confidence: number; odds?: number | null }[],
): { combinedChance: number | null; estOdds: number | null } {
  if (legs.length === 0) return { combinedChance: null, estOdds: null };
  const combinedChance = legs.reduce((p, l) => p * l.confidence, 1);
  const estOdds =
    Math.round(
      legs.reduce((p, l) => p * (l.odds ?? 1 / Math.max(l.confidence, 0.05)), 1) *
        100,
    ) / 100;
  return { combinedChance, estOdds };
}

async function persistMaterialisedTickets(
  gameId: number,
  materialised: ReturnType<typeof materialiseSelections>,
  placementByKey: Map<
    string,
    { stake: number | null; placedOdds: number | null }
  >,
): Promise<void> {
  for (const t of materialised) {
    const kept = placementByKey.get(t.strategyKey);
    const [ticket] = await db
      .insert(systemTickets)
      .values({
        gameId,
        strategyKey: t.strategyKey,
        focus: t.focus,
        legCount: t.legs.length,
        tier: t.tier,
        modelledChance: t.modelledChance,
        estOdds: t.estOdds,
        stake: kept?.stake ?? null,
        placedOdds: kept?.placedOdds ?? null,
        legsTotal: t.legs.length,
        legsHit: 0,
        slipHit: null,
        flatReturn: 0,
        cashReturn: 0,
      })
      .returning();

    await db.insert(systemTicketLegs).values(
      t.legs.map((l) => ({
        ticketId: ticket!.id,
        playerId: l.playerId,
        playerName: l.playerName,
        team: l.team,
        statType: l.statType as StatType,
        line: l.line,
        prediction: l.prediction,
        confidence: l.confidence,
        actualValue: null,
        hit: null,
      })),
    );
  }
}

/**
 * 3-card chooser build: edge / hot / spread portfolios, persist the selected
 * card per slot (default green/edge). Returns chooser for the UI.
 */
export async function buildSystemBookWithChooser(
  gameId: number,
  opts?: {
    policy?: ActivePolicyView;
    k?: number;
    userId?: number | null;
    selections?: Record<string, CardStyle>;
  },
): Promise<{
  tickets: SystemTicketView[];
  metrics: PortfolioMetrics;
  chooser: ChooserBook;
  selections: Record<string, CardStyle>;
  draftFillEnabled: boolean;
  edgeScoreEnabled: boolean;
}> {
  const policy = opts?.policy ?? (await ensureActivePolicy());
  const k = opts?.k ?? PORTFOLIO_K;
  const { ranked } = await selectStrategiesForGame(gameId, policy, k);
  const { bands } = await getGameBenchmarkBands(gameId);

  const prior = await db
    .select({
      strategyKey: systemTickets.strategyKey,
      stake: systemTickets.stake,
      placedOdds: systemTickets.placedOdds,
    })
    .from(systemTickets)
    .where(eq(systemTickets.gameId, gameId));
  const placementByKey = new Map(
    prior.map((p) => [p.strategyKey, { stake: p.stake, placedOdds: p.placedOdds }]),
  );

  await db.delete(systemTickets).where(eq(systemTickets.gameId, gameId));

  const pool = await loadFillPool(gameId, bands, opts?.userId ?? null, {
    edgePackage: true,
  });
  const slots = strategiesToSlots(ranked);
  const tierByKey = new Map(ranked.map((s) => [s.strategyKey, s.tier]));

  const chooser = buildChooserBook(slots, pool, {
    labelFor: (key, n) => strategyLabel(key, n),
    tierFor: (key, isFun) => {
      if (isFun) return "fun";
      const t = tierByKey.get(key) ?? "balanced";
      return t === "fun" ? "fun" : t;
    },
  });

  const selections: Record<string, CardStyle> = { ...opts?.selections };
  for (const slot of chooser.slots) {
    if (!selections[slot.strategyKey]) selections[slot.strategyKey] = "edge";
  }

  const materialised = materialiseSelections(chooser, selections);
  await persistMaterialisedTickets(gameId, materialised, placementByKey);

  const tickets = await attachEdgeHotBadges(gameId, await getSystemBook(gameId));
  return {
    tickets,
    metrics: bookMetricsFromViews(tickets),
    chooser,
    selections,
    draftFillEnabled: isPortfolioDraftFillEnabled(),
    edgeScoreEnabled: isPortfolioEdgeScoreEnabled(),
  };
}

/**
 * Build top-K strategy tickets for a game from active policy + H2H Lab playbook.
 * Replaces any existing ungraded/graded tickets for this game (refresh).
 *
 * When `PORTFOLIO_DRAFT_FILL` is on, uses snake-draft fill; default OFF keeps
 * per-ticket greedy `buildSuggestions` (unchanged until maintainer flips flag).
 */
export async function buildAndPersistSystemPortfolio(
  gameId: number,
  opts?: { policy?: ActivePolicyView; k?: number; userId?: number | null },
): Promise<SystemTicketView[]> {
  const policy = opts?.policy ?? (await ensureActivePolicy());
  const k = opts?.k ?? PORTFOLIO_K;

  const { ranked } = await selectStrategiesForGame(gameId, policy, k);
  const { bands } = await getGameBenchmarkBands(gameId);

  // Keep stake/odds if regenerating the same strategy keys.
  const prior = await db
    .select({
      strategyKey: systemTickets.strategyKey,
      stake: systemTickets.stake,
      placedOdds: systemTickets.placedOdds,
    })
    .from(systemTickets)
    .where(eq(systemTickets.gameId, gameId));
  const placementByKey = new Map(
    prior.map((p) => [p.strategyKey, { stake: p.stake, placedOdds: p.placedOdds }]),
  );

  // Wipe prior book for this game (idempotent regenerate).
  await db.delete(systemTickets).where(eq(systemTickets.gameId, gameId));

  const useDraft = isPortfolioDraftFillEnabled();

  if (useDraft) {
    const pool = await loadFillPool(gameId, bands, opts?.userId ?? null);
    const slots = strategiesToSlots(ranked);
    const filled = runPortfolioFill(slots, pool, "draft");
    const tierByKey = new Map(ranked.map((s) => [s.strategyKey, s.tier]));
    const focusByKey = new Map(ranked.map((s) => [s.strategyKey, s.focus]));

    for (const t of filled.tickets) {
      if (t.legs.length === 0) continue;
      const kept = placementByKey.get(t.strategyKey);
      const tierRaw = tierByKey.get(t.strategyKey) ?? "balanced";
      const tier = t.isFun || tierRaw === "fun" ? "fun" : tierRaw;
      const { combinedChance, estOdds } = modelStatsFromLegs(t.legs);

      const [ticket] = await db
        .insert(systemTickets)
        .values({
          gameId,
          strategyKey: t.strategyKey,
          focus: focusByKey.get(t.strategyKey) ?? "any",
          legCount: t.legs.length,
          tier,
          modelledChance: combinedChance,
          estOdds,
          stake: kept?.stake ?? null,
          placedOdds: kept?.placedOdds ?? null,
          legsTotal: t.legs.length,
          legsHit: 0,
          slipHit: null,
          flatReturn: 0,
          cashReturn: 0,
        })
        .returning();

      await db.insert(systemTicketLegs).values(
        t.legs.map((l) => ({
          ticketId: ticket!.id,
          playerId: l.playerId,
          playerName: l.playerName,
          team: l.team,
          statType: l.statType as StatType,
          line: l.line,
          prediction: l.prediction,
          confidence: l.confidence,
          actualValue: null,
          hit: null,
        })),
      );
    }

    return getSystemBook(gameId);
  }

  for (const strat of ranked) {
    const focus = strat.focus as StatFocus;
    const suggestion = await buildSuggestions(
      gameId,
      focus,
      strat.legCount,
      opts?.userId ?? null,
      { benchmarks: bands },
    );
    if (suggestion.legs.length === 0) continue;

    const kept = placementByKey.get(strat.strategyKey);
    const tier = strat.tier === "fun" ? "fun" : strat.tier;

    const [ticket] = await db
      .insert(systemTickets)
      .values({
        gameId,
        strategyKey: strat.strategyKey,
        focus: strat.focus,
        legCount: suggestion.legs.length,
        tier,
        modelledChance: suggestion.combinedChance,
        estOdds: suggestion.estOdds,
        stake: kept?.stake ?? null,
        placedOdds: kept?.placedOdds ?? null,
        legsTotal: suggestion.legs.length,
        legsHit: 0,
        slipHit: null,
        flatReturn: 0,
        cashReturn: 0,
      })
      .returning();

    await db.insert(systemTicketLegs).values(
      suggestion.legs.map((l: SuggestedLeg) => ({
        ticketId: ticket!.id,
        playerId: l.playerId,
        playerName: l.playerName,
        team: l.team,
        statType: l.statType,
        line: l.line,
        prediction: l.prediction,
        confidence: l.confidence,
        actualValue: null,
        hit: null,
      })),
    );
  }

  return getSystemBook(gameId);
}
