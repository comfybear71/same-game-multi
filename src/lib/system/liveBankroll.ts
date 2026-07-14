import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { games, systemTickets } from "@/db/schema";
import { BACKTEST_STRATEGIES } from "@/lib/backtest/matrix";
import { currentSeason } from "@/lib/cron";

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
  cashReturn: number;
  pnl: number | null;
}

export interface LiveSystemBankroll {
  season: number;
  /** Tickets with a stake entered. */
  ticketsTracked: number;
  ticketsGraded: number;
  ticketsHit: number;
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
): number | null {
  if (stake == null || stake <= 0) return null;
  if (slipHit == null) return null;
  return cashReturn - stake;
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
      cashReturn: systemTickets.cashReturn,
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

  let totalStaked = 0;
  let openStake = 0;
  let settledStake = 0;
  let totalReturned = 0;
  let ticketsHit = 0;
  let ticketsGraded = 0;
  let ticketsPending = 0;

  for (const r of tracked) {
    totalStaked += r.stake!;
    if (r.slipHit == null) {
      openStake += r.stake!;
      ticketsPending++;
    } else {
      settledStake += r.stake!;
      totalReturned += r.cashReturn;
      ticketsGraded++;
      if (r.slipHit) ticketsHit++;
    }
  }

  const labelOf = (key: string) =>
    BACKTEST_STRATEGIES.find((s) => s.key === key)?.label ?? key;

  return {
    season: yr,
    ticketsTracked: tracked.length,
    ticketsGraded,
    ticketsHit,
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
      cashReturn: r.cashReturn,
      pnl: cashPnl(r.stake, r.cashReturn, r.slipHit),
    })),
  };
}
