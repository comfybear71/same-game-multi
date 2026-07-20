import { and, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/db";
import {
  games,
  lineupPlayers,
  players,
  playerGameStats,
  predictions,
} from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { actualForGame } from "@/lib/predictions/features";
import { getPlayerHistory } from "./aflTables";

// After a game completes, pull each predicted/lineup player's actual stat line
// from AFL Tables and write it to player_game_stats. Powers bet settlement and
// the accuracy scorecard. Degrades gracefully: players whose actuals aren't up
// yet are left for the next run.

export interface PlayerStatsResult {
  gameId: number;
  recorded: number;
  pending: number;
  skipped: number;
}

/** Players we care about for a game — predictions ∪ lineup (not the whole club list). */
async function playersForGame(
  gameId: number,
): Promise<
  { id: number; name: string; team: string; aflTablesSlug: string | null }[]
> {
  const [predRows, lineupRows] = await Promise.all([
    db
      .selectDistinct({
        id: players.id,
        name: players.name,
        team: players.team,
        aflTablesSlug: players.aflTablesSlug,
      })
      .from(predictions)
      .innerJoin(players, eq(predictions.playerId, players.id))
      .where(eq(predictions.gameId, gameId)),
    db
      .selectDistinct({
        id: players.id,
        name: players.name,
        team: players.team,
        aflTablesSlug: players.aflTablesSlug,
      })
      .from(lineupPlayers)
      .innerJoin(players, eq(lineupPlayers.playerId, players.id))
      .where(
        and(
          eq(lineupPlayers.gameId, gameId),
          ne(lineupPlayers.status, "emergency"),
        ),
      ),
  ]);

  const byId = new Map<
    number,
    { id: number; name: string; team: string; aflTablesSlug: string | null }
  >();
  for (const p of [...predRows, ...lineupRows]) {
    if (p.id != null) byId.set(p.id, p);
  }
  return [...byId.values()];
}

/** Settle actual player stats for one completed game (append / upsert only). */
export async function settleGamePlayerStats(
  gameId: number,
): Promise<PlayerStatsResult> {
  const game = (
    await db.select().from(games).where(eq(games.id, gameId)).limit(1)
  )[0];
  if (!game || game.status !== "complete" || game.round == null) {
    return { gameId, recorded: 0, pending: 0, skipped: 0 };
  }

  const homeC = canonicalTeam(game.home) ?? game.home;
  const awayC = canonicalTeam(game.away) ?? game.away;
  const season = game.season ?? new Date().getUTCFullYear();

  const involved = await playersForGame(gameId);
  if (involved.length === 0) {
    return { gameId, recorded: 0, pending: 0, skipped: 0 };
  }

  // Already settled — don't re-scrape AFL Tables.
  const existing = await db
    .select({
      playerId: playerGameStats.playerId,
      settled: playerGameStats.settled,
      didPlay: playerGameStats.didPlay,
    })
    .from(playerGameStats)
    .where(
      and(
        eq(playerGameStats.gameId, gameId),
        inArray(
          playerGameStats.playerId,
          involved.map((p) => p.id),
        ),
      ),
    );
  // Skip only confirmed played+settled rows. Retry false DNPs — scrape misses
  // used to invent didPlay=false and wrongly void System tickets.
  const settledIds = new Set(
    existing
      .filter((r) => r.settled && r.didPlay !== false)
      .map((r) => r.playerId),
  );

  let recorded = 0;
  let pending = 0;
  let skipped = 0;

  for (const p of involved) {
    if (settledIds.has(p.id)) {
      skipped++;
      continue;
    }
    const t = canonicalTeam(p.team) ?? p.team;
    const opponent = t === homeC ? awayC : homeC;
    const history = await getPlayerHistory(p.name, p.aflTablesSlug);
    const actual = actualForGame(
      history.gameLog,
      season,
      String(game.round),
      opponent,
    );
    if (!actual) {
      // Only mark DNP when we clearly scraped a career page that already has
      // other games this season — missing this fixture ⇒ didn't play.
      // Empty / 404 scrapes (e.g. wrong Jack_Graham slug) stay pending — never
      // invent "injured" (that wrongly voided System tickets).
      const seasonGames = history.gameLog.filter((g) => g.season === season);
      const confidentDnp = seasonGames.length >= 3;
      if (!confidentDnp) {
        pending++;
        continue;
      }
      await db
        .insert(playerGameStats)
        .values({
          playerId: p.id,
          gameId,
          disposals: null,
          marks: null,
          tackles: null,
          goals: null,
          didPlay: false,
          settled: true,
        })
        .onConflictDoUpdate({
          target: [playerGameStats.playerId, playerGameStats.gameId],
          set: {
            disposals: null,
            marks: null,
            tackles: null,
            goals: null,
            didPlay: false,
            settled: true,
          },
        });
      recorded++;
      continue;
    }
    await db
      .insert(playerGameStats)
      .values({
        playerId: p.id,
        gameId,
        disposals: actual.disposals,
        marks: actual.marks,
        tackles: actual.tackles,
        goals: actual.goals,
        didPlay: true,
        settled: true,
      })
      .onConflictDoUpdate({
        target: [playerGameStats.playerId, playerGameStats.gameId],
        set: {
          disposals: actual.disposals,
          marks: actual.marks,
          tackles: actual.tackles,
          goals: actual.goals,
          didPlay: true,
          settled: true,
        },
      });
    recorded++;
  }

  return { gameId, recorded, pending, skipped };
}
