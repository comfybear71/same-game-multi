import { asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { games, systemTicketLegs, systemTickets } from "@/db/schema";
import { BACKTEST_STRATEGIES } from "@/lib/backtest/matrix";
import { currentSeason } from "@/lib/cron";
import { targetLabel } from "@/lib/format";

export interface LiveSystemTicketLeg {
  id: number;
  playerName: string;
  team: string | null;
  statType: string;
  line: number;
  actualValue: number | null;
  hit: boolean | null;
  voided: boolean;
}

export interface LiveSystemTicketRow {
  id: number;
  gameId: number;
  season: number;
  round: number | null;
  home: string;
  away: string;
  commenceTime: Date;
  strategyKey: string;
  label: string;
  tier: string;
  stake: number | null;
  placedOdds: number | null;
  estOdds: number | null;
  slipHit: boolean | null;
  voided: boolean;
  cashReturn: number;
  pnl: number | null;
  legs: LiveSystemTicketLeg[];
}

export interface LiveSystemBankroll {
  season: number;
  /** Tickets with a stake entered. */
  ticketsTracked: number;
  ticketsGraded: number;
  ticketsHit: number;
  ticketsVoided: number;
  ticketsPending: number;
  /** Sum of stakes entered (all tracked). */
  totalStaked: number;
  /** Sum of stakes on still-open (ungraded) tickets. */
  openStake: number;
  /** Sum of stakes on graded tickets. */
  settledStake: number;
  /** Sum of cash returns on graded tickets. */
  totalReturned: number;
  /** totalReturned − settledStake */
  netProfit: number;
  tickets: LiveSystemTicketRow[];
}

function cashPnl(
  stake: number | null,
  cashReturn: number,
  slipHit: boolean | null,
  voided: boolean,
): number | null {
  if (stake == null || stake <= 0) return null;
  if (!voided && slipHit == null) return null;
  return cashReturn - stake;
}

function isGraded(slipHit: boolean | null, voided: boolean, gradedAt: Date | null): boolean {
  return voided || slipHit != null || gradedAt != null;
}

/** Season-to-date System book cash tally from manually entered stake/odds. */
export async function getLiveSystemBankroll(
  season?: number,
): Promise<LiveSystemBankroll> {
  const yr = season ?? currentSeason();

  const rows = await db
    .select({
      id: systemTickets.id,
      gameId: systemTickets.gameId,
      strategyKey: systemTickets.strategyKey,
      tier: systemTickets.tier,
      stake: systemTickets.stake,
      placedOdds: systemTickets.placedOdds,
      estOdds: systemTickets.estOdds,
      slipHit: systemTickets.slipHit,
      voided: systemTickets.voided,
      cashReturn: systemTickets.cashReturn,
      gradedAt: systemTickets.gradedAt,
      season: games.season,
      round: games.round,
      home: games.home,
      away: games.away,
      commenceTime: games.commenceTime,
    })
    .from(systemTickets)
    .innerJoin(games, eq(games.id, systemTickets.gameId))
    .where(eq(games.season, yr))
    .orderBy(asc(games.commenceTime), asc(systemTickets.id));

  const tracked = rows.filter((r) => r.stake != null && r.stake > 0);
  const trackedIds = tracked.map((r) => r.id);

  const legRows =
    trackedIds.length === 0
      ? []
      : await db
          .select({
            id: systemTicketLegs.id,
            ticketId: systemTicketLegs.ticketId,
            playerName: systemTicketLegs.playerName,
            team: systemTicketLegs.team,
            statType: systemTicketLegs.statType,
            line: systemTicketLegs.line,
            actualValue: systemTicketLegs.actualValue,
            hit: systemTicketLegs.hit,
            voided: systemTicketLegs.voided,
          })
          .from(systemTicketLegs)
          .where(inArray(systemTicketLegs.ticketId, trackedIds))
          .orderBy(asc(systemTicketLegs.id));

  const legsByTicket = new Map<number, LiveSystemTicketLeg[]>();
  for (const l of legRows) {
    const list = legsByTicket.get(l.ticketId) ?? [];
    list.push({
      id: l.id,
      playerName: l.playerName,
      team: l.team,
      statType: l.statType,
      line: l.line,
      actualValue: l.actualValue,
      hit: l.hit,
      voided: l.voided,
    });
    legsByTicket.set(l.ticketId, list);
  }

  let totalStaked = 0;
  let openStake = 0;
  let settledStake = 0;
  let totalReturned = 0;
  let ticketsHit = 0;
  let ticketsVoided = 0;
  let ticketsGraded = 0;
  let ticketsPending = 0;

  for (const r of tracked) {
    totalStaked += r.stake!;
    const graded = isGraded(r.slipHit, r.voided, r.gradedAt);
    if (!graded) {
      openStake += r.stake!;
      ticketsPending++;
    } else {
      settledStake += r.stake!;
      totalReturned += r.cashReturn;
      ticketsGraded++;
      if (r.voided) ticketsVoided++;
      else if (r.slipHit) ticketsHit++;
    }
  }

  const labelOf = (key: string) =>
    BACKTEST_STRATEGIES.find((s) => s.key === key)?.label ?? key;

  return {
    season: yr,
    ticketsTracked: tracked.length,
    ticketsGraded,
    ticketsHit,
    ticketsVoided,
    ticketsPending,
    totalStaked,
    openStake,
    settledStake,
    totalReturned,
    netProfit: totalReturned - settledStake,
    tickets: tracked.map((r) => ({
      id: r.id,
      gameId: r.gameId,
      season: r.season ?? yr,
      round: r.round,
      home: r.home,
      away: r.away,
      commenceTime: r.commenceTime,
      strategyKey: r.strategyKey,
      label: labelOf(r.strategyKey),
      tier: r.tier,
      stake: r.stake,
      placedOdds: r.placedOdds,
      estOdds: r.estOdds,
      slipHit: r.slipHit,
      voided: r.voided,
      cashReturn: r.cashReturn,
      pnl: cashPnl(r.stake, r.cashReturn, r.slipHit, r.voided),
      legs: legsByTicket.get(r.id) ?? [],
    })),
  };
}

/** Format a system leg for the expand row. */
export function formatSystemLegLine(leg: LiveSystemTicketLeg): string {
  const market = `${capitalize(leg.statType)} ${targetLabel(leg.line)}`;
  return `${leg.playerName} · ${market}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
