import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  playerGameStats,
  players,
  systemTicketLegs,
  systemTickets,
  type StatType,
} from "@/db/schema";
import { computeCashReturn } from "@/lib/system/cash";

function actualForStat(
  row: {
    disposals: number | null;
    marks: number | null;
    tackles: number | null;
    goals: number | null;
    didPlay: boolean | null;
  },
  stat: StatType,
): number | null {
  const v = row[stat];
  return v == null ? null : v;
}

/**
 * Grade system-book tickets for a game from player_game_stats actuals.
 * DNP / injured (didPlay=false) → leg voided; any void → ticket voided (stake back).
 * Legs without a matched player/stat actual are left ungraded.
 */
export async function gradeSystemBookForGame(gameId: number): Promise<{
  ticketsGraded: number;
  legsUpdated: number;
}> {
  const tickets = await db
    .select()
    .from(systemTickets)
    .where(eq(systemTickets.gameId, gameId));
  if (tickets.length === 0) return { ticketsGraded: 0, legsUpdated: 0 };

  const ticketIds = tickets.map((t) => t.id);
  const legs = await db
    .select()
    .from(systemTicketLegs)
    .where(inArray(systemTicketLegs.ticketId, ticketIds));

  const playerIds = [
    ...new Set(legs.map((l) => l.playerId).filter((id): id is number => id != null)),
  ];
  const stats =
    playerIds.length === 0
      ? []
      : await db
          .select()
          .from(playerGameStats)
          .where(
            and(
              eq(playerGameStats.gameId, gameId),
              inArray(playerGameStats.playerId, playerIds),
            ),
          );

  const statsByPlayer = new Map(stats.map((s) => [s.playerId, s]));

  // Resolve missing playerIds by name when possible.
  const namesNeedingId = [
    ...new Set(legs.filter((l) => l.playerId == null).map((l) => l.playerName)),
  ];
  const nameRows =
    namesNeedingId.length === 0
      ? []
      : await db
          .select({ id: players.id, name: players.name })
          .from(players)
          .where(inArray(players.name, namesNeedingId));
  const idByName = new Map(nameRows.map((p) => [p.name, p.id]));

  let legsUpdated = 0;
  const legsByTicket = new Map<number, typeof legs>();
  for (const leg of legs) {
    const list = legsByTicket.get(leg.ticketId) ?? [];
    list.push(leg);
    legsByTicket.set(leg.ticketId, list);
  }

  let ticketsGraded = 0;

  for (const ticket of tickets) {
    const ticketLegs = legsByTicket.get(ticket.id) ?? [];
    let legsHit = 0;
    let anyVoid = false;
    let allResolved = ticketLegs.length > 0;

    for (const leg of ticketLegs) {
      const pid = leg.playerId ?? idByName.get(leg.playerName) ?? null;
      const statRow = pid != null ? statsByPlayer.get(pid) : undefined;
      if (!statRow || !statRow.settled) {
        allResolved = false;
        continue;
      }

      if (statRow.didPlay === false) {
        anyVoid = true;
        await db
          .update(systemTicketLegs)
          .set({
            playerId: pid,
            actualValue: null,
            hit: null,
            voided: true,
          })
          .where(eq(systemTicketLegs.id, leg.id));
        legsUpdated++;
        continue;
      }

      const actual = actualForStat(statRow, leg.statType);
      if (actual == null) {
        allResolved = false;
        continue;
      }
      const hit = actual > leg.line;
      if (hit) legsHit++;
      await db
        .update(systemTicketLegs)
        .set({
          playerId: pid,
          actualValue: actual,
          hit,
          voided: false,
        })
        .where(eq(systemTicketLegs.id, leg.id));
      legsUpdated++;
    }

    if (!allResolved) {
      await db
        .update(systemTickets)
        .set({
          legsHit,
          legsTotal: ticketLegs.length,
        })
        .where(eq(systemTickets.id, ticket.id));
      continue;
    }

    // Same rule as personal bets: any void leg → stake returned.
    const voided = anyVoid;
    const slipHit = voided
      ? null
      : legsHit === ticketLegs.length && ticketLegs.length > 0;
    const flatReturn =
      !voided && slipHit && ticket.estOdds != null ? ticket.estOdds : 0;
    const cashReturn = computeCashReturn(
      slipHit,
      ticket.stake,
      ticket.placedOdds,
      voided,
    );
    await db
      .update(systemTickets)
      .set({
        legsHit,
        legsTotal: ticketLegs.length,
        slipHit,
        voided,
        flatReturn,
        cashReturn,
        gradedAt: new Date(),
      })
      .where(eq(systemTickets.id, ticket.id));
    ticketsGraded++;
  }

  return { ticketsGraded, legsUpdated };
}

/** Grade all system tickets for completed games that still need grading. */
export async function gradePendingSystemBooks(gameIds?: number[]): Promise<{
  games: number;
  ticketsGraded: number;
}> {
  const pending = await db
    .select({ gameId: systemTickets.gameId })
    .from(systemTickets)
    .where(isNull(systemTickets.gradedAt));
  const ids = [
    ...new Set(
      pending
        .map((p) => p.gameId)
        .filter((id) => (gameIds == null ? true : gameIds.includes(id))),
    ),
  ];

  let ticketsGraded = 0;
  for (const gameId of ids) {
    const res = await gradeSystemBookForGame(gameId);
    ticketsGraded += res.ticketsGraded;
  }
  return { games: ids.length, ticketsGraded };
}
