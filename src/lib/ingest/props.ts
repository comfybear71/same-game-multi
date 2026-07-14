import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookmakerLines } from "@/db/schema";

// Bookmaker prop lines used to come from The Odds API. That integration is
// retired — suggestions use model lines + estimated odds. This module only
// keeps a count helper for any rows still in the DB.

/** How many bookmaker prop lines are stored for a game (0 = none). */
export async function countBookmakerLines(gameId: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookmakerLines)
    .where(eq(bookmakerLines.gameId, gameId));
  return rows[0]?.count ?? 0;
}
