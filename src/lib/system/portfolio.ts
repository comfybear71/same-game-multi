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
import {
  isPortfolioDraftFillEnabled,
  type PortfolioMetrics,
} from "@/lib/system/portfolioFill";
import {
  loadFillPool,
  metricsFromLegSets,
  runPortfolioFill,
  strategiesToSlots,
} from "@/lib/system/portfolioFillBridge";

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

export interface SystemTicketView {
  id: number;
  gameId: number;
  strategyKey: string;
  focus: string;
  legCount: number;
  tier: string;
  label: string;
  modelledChance: number | null;
  estOdds: number | null;
  placedOdds: number | null;
  stake: number | null;
  legsHit: number;
  legsTotal: number;
  slipHit: boolean | null;
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
    /** Leaders stamp — position / season avg / Elite→Below. */
    position?: PositionBucket | null;
    seasonAvg?: number | null;
    benchmark?: BenchmarkBand | "unknown" | null;
    percentile?: number | null;
  }[];
}

export type SystemBookResponse = {
  tickets: SystemTicketView[];
  metrics: PortfolioMetrics;
  draftFillEnabled: boolean;
};

function bookMetricsFromViews(tickets: SystemTicketView[]): PortfolioMetrics {
  return metricsFromLegSets(
    tickets.map((t) => ({
      strategyKey: t.strategyKey,
      isFun: t.tier === "fun",
      legs: t.legs,
    })),
  );
}

export async function getSystemBookResponse(
  gameId: number,
): Promise<SystemBookResponse> {
  const tickets = await getSystemBook(gameId);
  return {
    tickets,
    metrics: bookMetricsFromViews(tickets),
    draftFillEnabled: isPortfolioDraftFillEnabled(),
  };
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

  const cashReturn = computeCashReturn(existing.slipHit, stake, placedOdds);

  await db
    .update(systemTickets)
    .set({ stake, placedOdds, cashReturn })
    .where(eq(systemTickets.id, ticketId));

  const book = await getSystemBook(existing.gameId);
  return book.find((t) => t.id === ticketId) ?? null;
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
      cashReturn: computeCashReturn(ticket.slipHit, ticket.stake, ticket.placedOdds),
    })
    .where(eq(systemTickets.id, ticket.id));

  const book = await getSystemBook(ticket.gameId);
  return book.find((t) => t.id === ticket.id) ?? null;
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
