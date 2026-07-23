import { and, asc, desc, eq, gte, lt, lte, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { games, type Game } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";

// Read helpers for the UI. Server-only.

/**
 * Games that have started but aren't marked complete — "in play / awaiting
 * result". The live score/clock is confirmed per-game from Squiggle in the UI.
 *
 * The window runs back 24h, not 4h: an evening game often isn't flipped to
 * "complete" until the next-morning settle cron, so a tighter window left it
 * showing nowhere (not upcoming, not in-play, not a result) for hours.
 */
export async function getInPlayGames(): Promise<Game[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(games)
    .where(
      and(
        gte(games.commenceTime, windowStart),
        lte(games.commenceTime, now),
        ne(games.status, "complete"),
      ),
    )
    .orderBy(asc(games.commenceTime));
}

/** Next upcoming (scheduled or in-progress) game by commence time. */
export async function getNextGame(): Promise<Game | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(games)
    .where(gte(games.commenceTime, now))
    .orderBy(asc(games.commenceTime))
    .limit(1);
  return rows[0] ?? null;
}

/** Upcoming games (optionally capped), soonest first. */
export async function getUpcomingGames(limit = 18): Promise<Game[]> {
  const now = new Date();
  return db
    .select()
    .from(games)
    .where(gte(games.commenceTime, now))
    .orderBy(asc(games.commenceTime))
    .limit(limit);
}

/** Most recent completed games, newest first. */
export async function getRecentResults(limit = 9): Promise<Game[]> {
  const now = new Date();
  return db
    .select()
    .from(games)
    .where(and(lt(games.commenceTime, now), eq(games.status, "complete")))
    .orderBy(desc(games.commenceTime))
    .limit(limit);
}

/**
 * Fixtures for linking a bet slip (No-round picker / New bet game select).
 * Upcoming + in-play + **full current season** completes (so R14 St Kilda v GWS
 * still appears when we're in R20+). Falls back to a deep recent window if
 * season isn't set on rows.
 */
export async function getLinkableGames(opts?: {
  upcomingLimit?: number;
  /** Extra seasons back (0 = current only). */
  seasonsBack?: number;
}): Promise<Game[]> {
  const upcomingLimit = opts?.upcomingLimit ?? 40;
  const seasonsBack = opts?.seasonsBack ?? 0;

  const [upcoming, inPlay, seasonRow] = await Promise.all([
    getUpcomingGames(upcomingLimit),
    getInPlayGames(),
    db
      .select({ season: games.season })
      .from(games)
      .where(sql`${games.season} is not null`)
      .orderBy(desc(games.season))
      .limit(1),
  ]);

  const currentSeason = seasonRow[0]?.season ?? new Date().getFullYear();
  const minSeason = currentSeason - Math.max(0, seasonsBack);

  let history: Game[] = [];
  try {
    history = await db
      .select()
      .from(games)
      .where(
        and(
          gte(games.season, minSeason),
          lte(games.season, currentSeason),
          // Include complete + any leftover scheduled/in-season rows.
          sql`${games.season} is not null`,
        ),
      )
      .orderBy(desc(games.commenceTime));
  } catch {
    history = await getRecentResults(200);
  }

  const seen = new Set<number>();
  const out: Game[] = [];
  // Prefer in-play / upcoming first, then season history (newest first).
  for (const g of [...inPlay, ...upcoming, ...history]) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g);
  }
  return out;
}

export async function getGameById(id: number): Promise<Game | null> {
  const rows = await db.select().from(games).where(eq(games.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Find a game by its two team names (any order) — the fixture between them
 * closest to right now. Two teams can meet twice a season (home & away), so
 * picking "most recent by kickoff" (i.e. the latest one on the fixture list)
 * would silently link a bet slip read today to a rematch weeks away. A slip
 * is always read for the game that's about to start or just finished, so the
 * nearest-in-time fixture — not the furthest-in-future one — is correct.
 */
export async function findGameByTeams(
  teamA: string | null,
  teamB: string | null,
): Promise<number | null> {
  const a = canonicalTeam(teamA);
  const b = canonicalTeam(teamB);
  if (!a || !b) return null;
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .where(
      or(
        and(eq(games.home, a), eq(games.away, b)),
        and(eq(games.home, b), eq(games.away, a)),
      ),
    )
    .orderBy(sql`abs(extract(epoch from (${games.commenceTime} - now())))`)
    .limit(1);
  return rows[0]?.id ?? null;
}

export type FormResult = "W" | "L" | "D";

/**
 * Each team's last `window` results (oldest → most recent) from completed
 * games, for the fixture-card form guide. Keyed by canonical team name.
 */
export async function getRecentTeamForm(
  window = 5,
): Promise<Map<string, FormResult[]>> {
  const rows = await db
    .select({
      home: games.home,
      away: games.away,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
    })
    .from(games)
    .where(eq(games.status, "complete"))
    .orderBy(asc(games.commenceTime));

  const byTeam = new Map<string, FormResult[]>();
  const add = (team: string, r: FormResult) => {
    const key = canonicalTeam(team) ?? team;
    const list = byTeam.get(key) ?? [];
    list.push(r);
    byTeam.set(key, list);
  };
  for (const g of rows) {
    if (g.homeScore == null || g.awayScore == null) continue;
    if (g.homeScore === g.awayScore) {
      add(g.home, "D");
      add(g.away, "D");
    } else {
      const homeWon = g.homeScore > g.awayScore;
      add(g.home, homeWon ? "W" : "L");
      add(g.away, homeWon ? "L" : "W");
    }
  }
  for (const [team, list] of byTeam) byTeam.set(team, list.slice(-window));
  return byTeam;
}

/** Games for a given round (for round-level dashboards). */
export async function getGamesByRound(
  season: number,
  round: number,
): Promise<Game[]> {
  return db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.round, round)))
    .orderBy(asc(games.commenceTime));
}
