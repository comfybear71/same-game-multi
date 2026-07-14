import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  systemTicketLegs,
  systemTickets,
  type StatType,
} from "@/db/schema";
import { BACKTEST_STRATEGIES } from "@/lib/backtest/matrix";
import {
  buildSuggestions,
  type StatFocus,
  type SuggestedLeg,
} from "@/lib/predictions/suggest";
import { computeCashReturn } from "@/lib/system/cash";
import {
  ensureActivePolicy,
  getActivePolicy,
  PORTFOLIO_K,
  type ActivePolicyView,
} from "@/lib/system/policy";

export { computeCashReturn };

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
  }[];
}

function strategyLabel(key: string): string {
  return BACKTEST_STRATEGIES.find((s) => s.key === key)?.label ?? key;
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

  return tickets
    .map((t) => ({
      id: t.id,
      gameId: t.gameId,
      strategyKey: t.strategyKey,
      focus: t.focus,
      legCount: t.legCount,
      tier: t.tier || tierByKey.get(t.strategyKey) || "balanced",
      label: strategyLabel(t.strategyKey),
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
      legs: (byTicket.get(t.id) ?? []).map((l) => ({
        id: l.id,
        playerId: l.playerId,
        playerName: l.playerName,
        team: l.team,
        statType: l.statType,
        line: l.line,
        prediction: l.prediction,
        confidence: l.confidence,
        actualValue: l.actualValue,
        hit: l.hit,
      })),
    }))
    .sort((a, b) => {
      const order = { banker: 0, balanced: 1, low: 2 } as Record<string, number>;
      return (order[a.tier] ?? 9) - (order[b.tier] ?? 9) || a.strategyKey.localeCompare(b.strategyKey);
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
 * Build top-K strategy tickets for a game from active policy + live suggestions.
 * Replaces any existing ungraded/graded tickets for this game (refresh).
 */
export async function buildAndPersistSystemPortfolio(
  gameId: number,
  opts?: { policy?: ActivePolicyView; k?: number },
): Promise<SystemTicketView[]> {
  const policy = opts?.policy ?? (await ensureActivePolicy());
  const k = opts?.k ?? PORTFOLIO_K;

  const ranked = [...policy.weights.strategies]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, k);

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

  for (const strat of ranked) {
    const focus = strat.focus as StatFocus;
    const suggestion = await buildSuggestions(gameId, focus, strat.legCount, null);
    if (suggestion.legs.length === 0) continue;

    const kept = placementByKey.get(strat.strategyKey);

    const [ticket] = await db
      .insert(systemTickets)
      .values({
        gameId,
        strategyKey: strat.strategyKey,
        focus: strat.focus,
        legCount: suggestion.legs.length,
        tier: strat.tier,
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
