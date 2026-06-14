import { eq } from "drizzle-orm";

import { db } from "@/db";
import { bookmakerLines, games } from "@/db/schema";
import { getPlayerProps, marketKeyToStat } from "./oddsApi";

// Fetch The Odds API player props for a game and store the bookmaker lines.
// These lines are both the squad seed (the players worth predicting) and the
// benchmark for the Edge Finder (our model vs the bookie line).

export interface PropsSyncResult {
  gameId: number;
  lines: number;
  players: number;
}

/** Sync player prop lines for one game. Requires game.oddsApiId. */
export async function syncPlayerProps(gameId: number): Promise<PropsSyncResult> {
  const game = (await db.select().from(games).where(eq(games.id, gameId)).limit(1))[0];
  if (!game) throw new Error(`game ${gameId} not found`);
  if (!game.oddsApiId) {
    return { gameId, lines: 0, players: 0 };
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
