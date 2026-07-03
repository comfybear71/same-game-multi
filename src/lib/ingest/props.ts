import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookmakerLines, games } from "@/db/schema";
import { env } from "@/lib/env";
import { getPlayerProps, marketKeyToStat } from "./oddsApi";

// Fetch The Odds API player props for a game and store the bookmaker lines.
// Optional — predictions and lineups no longer depend on this. When skipped, the
// stat board and multis use model projections; log bets via screenshot upload.

export interface PropsSyncResult {
  gameId: number;
  lines: number;
  players: number;
  skipped?: boolean;
  skipReason?: "no_key" | "no_event_id";
}

/** Sync player prop lines for one game. Skips quietly when Odds API is not configured. */
export async function syncPlayerProps(gameId: number): Promise<PropsSyncResult> {
  const game = (await db.select().from(games).where(eq(games.id, gameId)).limit(1))[0];
  if (!game) throw new Error(`game ${gameId} not found`);
  if (!env.ODDS_API_KEY) {
    return { gameId, lines: 0, players: 0, skipped: true, skipReason: "no_key" };
  }
  if (!game.oddsApiId) {
    return { gameId, lines: 0, players: 0, skipped: true, skipReason: "no_event_id" };
  }

  const event = await getPlayerProps(game.oddsApiId);

  // Collapse all bookmakers' outcomes into one line per (player, stat, book).
  type Row = typeof bookmakerLines.$inferInsert;
  const rows: Row[] = [];
  const playerNames = new Set<string>();

  for (const book of event.bookmakers ?? []) {
    for (const market of book.markets) {
      const stat = marketKeyToStat(market.key);
      if (!stat) continue;
      // Group Over/Under outcomes by player + line.
      const byPlayer = new Map<string, { line: number; over?: number; under?: number }>();
      for (const o of market.outcomes) {
        const player = o.description?.trim();
        if (!player || o.point == null) continue;
        const key = `${player}|${o.point}`;
        const rec = byPlayer.get(key) ?? { line: o.point };
        if (o.name.toLowerCase() === "over") rec.over = o.price;
        else if (o.name.toLowerCase() === "under") rec.under = o.price;
        byPlayer.set(key, rec);
        playerNames.add(player);
      }
      for (const [key, rec] of byPlayer) {
        const player = key.split("|")[0];
        rows.push({
          gameId,
          playerName: player,
          statType: stat,
          bookmaker: book.title,
          line: rec.line,
          overOdds: rec.over ?? null,
          underOdds: rec.under ?? null,
        });
      }
    }
  }

  // Replace this game's lines wholesale (idempotent refresh).
  await db.delete(bookmakerLines).where(eq(bookmakerLines.gameId, gameId));
  if (rows.length > 0) {
    await db.insert(bookmakerLines).values(rows);
  }

  return { gameId, lines: rows.length, players: playerNames.size };
}

/** How many bookmaker prop lines are stored for a game (0 = none synced yet). */
export async function countBookmakerLines(gameId: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookmakerLines)
    .where(eq(bookmakerLines.gameId, gameId));
  return rows[0]?.count ?? 0;
}
