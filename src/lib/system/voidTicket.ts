import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { systemTicketLegs, systemTickets } from "@/db/schema";
import { computeCashReturn } from "@/lib/system/cash";
import { getSystemBook } from "@/lib/system/portfolio";

/**
 * Manually void a System ticket (injured player bookie void, etc.).
 * Stake returned. Optional legId marks that leg as the void reason.
 * Pass voided=false to undo and leave ungraded (re-run settle to re-grade).
 */
export async function setSystemTicketVoided(
  ticketId: number,
  voided: boolean,
  opts?: { legId?: number },
): Promise<{ gameId: number } | null> {
  const [ticket] = await db
    .select()
    .from(systemTickets)
    .where(eq(systemTickets.id, ticketId))
    .limit(1);
  if (!ticket) return null;

  if (voided) {
    if (opts?.legId != null) {
      await db
        .update(systemTicketLegs)
        .set({ voided: true, hit: null })
        .where(
          and(
            eq(systemTicketLegs.id, opts.legId),
            eq(systemTicketLegs.ticketId, ticketId),
          ),
        );
    }
    const cashReturn = computeCashReturn(
      null,
      ticket.stake,
      ticket.placedOdds,
      true,
    );
    await db
      .update(systemTickets)
      .set({
        voided: true,
        slipHit: null,
        cashReturn,
        flatReturn: 0,
        gradedAt: new Date(),
      })
      .where(eq(systemTickets.id, ticketId));
  } else {
    await db
      .update(systemTicketLegs)
      .set({ voided: false })
      .where(eq(systemTicketLegs.ticketId, ticketId));
    await db
      .update(systemTickets)
      .set({
        voided: false,
        slipHit: null,
        cashReturn: 0,
        flatReturn: 0,
        gradedAt: null,
      })
      .where(eq(systemTickets.id, ticketId));
  }

  return { gameId: ticket.gameId };
}

/** Re-export book refresh helper for API responses. */
export async function voidSystemTicketAndReload(
  ticketId: number,
  voided: boolean,
  opts?: { legId?: number },
) {
  const res = await setSystemTicketVoided(ticketId, voided, opts);
  if (!res) return null;
  const book = await getSystemBook(res.gameId);
  return book.find((t) => t.id === ticketId) ?? null;
}
