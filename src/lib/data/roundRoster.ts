import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db";
import { games, lineupPlayers, type Game } from "@/db/schema";

export type RoundPlayerPhase = "played" | "live" | "upcoming";

export interface RoundLineupPlayer {
  name: string;
  team: string;
  jumper: number | null;
  position: string | null;
  lineupStatus: string;
  phase: RoundPlayerPhase;
  gameId: number;
  /** Short fixture label, e.g. "GEEL v BL". */
  fixture: string;
}

export interface RoundGameLineup {
  gameId: number;
  home: string;
  away: string;
  commenceTime: Date;
  status: Game["status"];
  phase: RoundPlayerPhase;
  lineupCount: number;
  players: RoundLineupPlayer[];
}

export interface RoundRoster {
  season: number;
  round: number;
  games: RoundGameLineup[];
  played: RoundLineupPlayer[];
  upcoming: RoundLineupPlayer[];
  live: RoundLineupPlayer[];
}

function teamAbbr(team: string): string {
  const words = team.split(/\s+/);
  const last = words[words.length - 1] ?? team;
  return last.slice(0, 4).toUpperCase();
}

function fixtureLabel(home: string, away: string): string {
  return `${teamAbbr(home)} v ${teamAbbr(away)}`;
}

function gamePhase(game: Game, now: Date): RoundPlayerPhase {
  if (game.status === "complete") return "played";
  if (game.commenceTime <= now) return "live";
  return "upcoming";
}

/** Round in focus: next fixture's round, else latest completed. */
export async function inferCurrentRound(season: number): Promise<number | null> {
  const now = new Date();
  const next = (
    await db
      .select({ round: games.round })
      .from(games)
      .where(and(eq(games.season, season), gte(games.commenceTime, now)))
      .orderBy(asc(games.commenceTime))
      .limit(1)
  )[0];
  if (next?.round != null) return next.round;

  const last = (
    await db
      .select({ round: games.round })
      .from(games)
      .where(and(eq(games.season, season), eq(games.status, "complete")))
      .orderBy(desc(games.commenceTime))
      .limit(1)
  )[0];
  return last?.round ?? null;
}

/** Lineups for every game in a round, split by played / live / upcoming. */
export async function getRoundRoster(
  season: number,
  round: number,
): Promise<RoundRoster> {
  const now = new Date();
  const roundGames = await db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.round, round)))
    .orderBy(asc(games.commenceTime));

  if (roundGames.length === 0) {
    return { season, round, games: [], played: [], upcoming: [], live: [] };
  }

  const gameIds = roundGames.map((g) => g.id);
  const lineupRows = await db
    .select({
      gameId: lineupPlayers.gameId,
      team: lineupPlayers.team,
      name: lineupPlayers.playerName,
      jumper: lineupPlayers.jumper,
      position: lineupPlayers.position,
      status: lineupPlayers.status,
    })
    .from(lineupPlayers)
    .where(inArray(lineupPlayers.gameId, gameIds));

  const byGameId = new Map<number, typeof lineupRows>();
  for (const row of lineupRows) {
    const arr = byGameId.get(row.gameId);
    if (arr) arr.push(row);
    else byGameId.set(row.gameId, [row]);
  }

  const played: RoundLineupPlayer[] = [];
  const live: RoundLineupPlayer[] = [];
  const upcoming: RoundLineupPlayer[] = [];
  const gamesOut: RoundGameLineup[] = [];

  for (const g of roundGames) {
    const phase = gamePhase(g, now);
    const fixture = fixtureLabel(g.home, g.away);
    const raw = byGameId.get(g.id) ?? [];
    const players: RoundLineupPlayer[] = raw.map((r) => ({
      name: r.name,
      team: r.team,
      jumper: r.jumper,
      position: r.position,
      lineupStatus: r.status,
      phase,
      gameId: g.id,
      fixture,
    }));

    for (const p of players) {
      if (phase === "played") played.push(p);
      else if (phase === "live") live.push(p);
      else upcoming.push(p);
    }

    gamesOut.push({
      gameId: g.id,
      home: g.home,
      away: g.away,
      commenceTime: g.commenceTime,
      status: g.status,
      phase,
      lineupCount: players.length,
      players,
    });
  }

  const sortPlayers = (a: RoundLineupPlayer, b: RoundLineupPlayer) =>
    a.team.localeCompare(b.team) ||
    (a.jumper ?? 999) - (b.jumper ?? 999) ||
    a.name.localeCompare(b.name);

  played.sort(sortPlayers);
  live.sort(sortPlayers);
  upcoming.sort(sortPlayers);

  return { season, round, games: gamesOut, played, upcoming, live };
}

/** Single-game lineup for the game detail page. */
export async function getGameLineupRoster(gameId: number): Promise<{
  game: Game | null;
  players: RoundLineupPlayer[];
}> {
  const game = (
    await db.select().from(games).where(eq(games.id, gameId)).limit(1)
  )[0];
  if (!game) return { game: null, players: [] };

  const now = new Date();
  const phase = gamePhase(game, now);
  const fixture = fixtureLabel(game.home, game.away);

  const rows = await db
    .select({
      team: lineupPlayers.team,
      name: lineupPlayers.playerName,
      jumper: lineupPlayers.jumper,
      position: lineupPlayers.position,
      status: lineupPlayers.status,
    })
    .from(lineupPlayers)
    .where(eq(lineupPlayers.gameId, gameId));

  const players: RoundLineupPlayer[] = rows
    .map((r) => ({
      name: r.name,
      team: r.team,
      jumper: r.jumper,
      position: r.position,
      lineupStatus: r.status,
      phase,
      gameId,
      fixture,
    }))
    .sort(
      (a, b) =>
        a.team.localeCompare(b.team) ||
        (a.jumper ?? 999) - (b.jumper ?? 999) ||
        a.name.localeCompare(b.name),
    );

  return { game, players };
}
