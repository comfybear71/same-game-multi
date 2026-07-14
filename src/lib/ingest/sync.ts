import { eq } from "drizzle-orm";

import { db } from "@/db";
import { games } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { fetchSquiggleRound, getSquiggleGames, matchSquiggleFixture, type SquiggleGame } from "./squiggle";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture sync: Squiggle is authoritative for schedule + results.
// Idempotent — safe to run on every cron tick.
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a Squiggle local datetime + tz offset into a real UTC Date. */
function squiggleDateToUtc(g: SquiggleGame): Date {
  // g.date looks like "2026-06-14 17:40:00"; g.tz like "+10:00" or "+08:00".
  const iso = `${g.date.replace(" ", "T")}${g.tz ?? "+10:00"}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Fallback: assume AEST if parsing failed.
    return new Date(`${g.date.replace(" ", "T")}+10:00`);
  }
  return d;
}

function statusFromComplete(complete: number): "scheduled" | "in_progress" | "complete" {
  if (complete >= 100) return "complete";
  if (complete > 0) return "in_progress";
  return "scheduled";
}

export interface SyncResult {
  season: number;
  upserted: number;
  skipped: number;
}

/** Sync the full season's fixtures + results from Squiggle into `games`. */
export async function syncFixtures(season: number): Promise<SyncResult> {
  const squiggleGames = await getSquiggleGames(season);

  let upserted = 0;
  let skipped = 0;
  for (const g of squiggleGames) {
    // Future/finals placeholders can come back without teams assigned yet.
    // home/away are NOT NULL, so skip until both sides are known.
    if (!g.hteam || !g.ateam) {
      skipped++;
      continue;
    }
    const home = canonicalTeam(g.hteam) ?? g.hteam;
    const away = canonicalTeam(g.ateam) ?? g.ateam;

    await db
      .insert(games)
      .values({
        round: g.round,
        season: g.year,
        home,
        away,
        venue: g.venue,
        commenceTime: squiggleDateToUtc(g),
        status: statusFromComplete(g.complete),
        squiggleId: g.id,
        homeScore: g.hscore,
        awayScore: g.ascore,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: games.squiggleId,
        set: {
          round: g.round,
          season: g.year,
          home,
          away,
          venue: g.venue,
          commenceTime: squiggleDateToUtc(g),
          status: statusFromComplete(g.complete),
          homeScore: g.hscore,
          awayScore: g.ascore,
          updatedAt: new Date(),
        },
      });
    upserted++;
  }

  return { season, upserted, skipped };
}

/** Refresh one game's result/score from Squiggle — fast, used by Game over. */
export async function refreshGameFromSquiggle(gameId: number): Promise<boolean> {
  const game = (
    await db.select().from(games).where(eq(games.id, gameId)).limit(1)
  )[0];
  if (!game || game.season == null || game.round == null) return false;

  const roundGames = await fetchSquiggleRound(game.season, game.round);
  const match = matchSquiggleFixture(roundGames, game.squiggleId, game.home, game.away);
  if (!match?.game.hteam || !match.game.ateam) return false;

  const g = match.game;
  const homeScore = match.flip ? g.ascore : g.hscore;
  const awayScore = match.flip ? g.hscore : g.ascore;

  await db
    .update(games)
    .set({
      squiggleId: g.id,
      status: statusFromComplete(g.complete),
      homeScore,
      awayScore,
      updatedAt: new Date(),
    })
    .where(eq(games.id, gameId));

  return true;
}
