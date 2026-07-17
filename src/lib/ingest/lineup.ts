import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  games,
  lineupPlayers,
  players,
  predictions,
  type LineupStatus,
} from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import type { ExtractedLineup } from "@/lib/ai/readLineup";
import { normalisePlayerName } from "@/lib/playerName";

// Persist a screenshot-read team sheet as a game's lineup. The stored names are
// the squad seed that prediction generation runs off (see generate.ts), so we
// do our best to land on the player's full, AFL-Tables-resolvable name:
//   1. canonicalise the club and keep only the game's two teams,
//   2. reconcile each player against players we already know (by club + jumper,
//      then club + surname) and prefer that stored full name,
//   3. otherwise keep the model's extracted name.

export interface SaveLineupResult {
  gameId: number;
  stored: number;
  teams: string[];
  // Players whose club didn't match either side of the fixture (dropped).
  dropped: string[];
}

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export async function saveLineup(
  gameId: number,
  extracted: ExtractedLineup,
  sourceUrl: string | null,
): Promise<SaveLineupResult> {
  const game = (await db.select().from(games).where(eq(games.id, gameId)).limit(1))[0];
  if (!game) throw new Error(`game ${gameId} not found`);

  const homeC = canonicalTeam(game.home) ?? game.home;
  const awayC = canonicalTeam(game.away) ?? game.away;
  const valid = new Map<string, string>([
    [homeC.toLowerCase(), homeC],
    [awayC.toLowerCase(), awayC],
  ]);

  // Existing players for both clubs let us recover full names from initials.
  const knownRows = await db
    .select({ name: players.name, team: players.team, jumper: players.jumper })
    .from(players);
  const known = knownRows.filter((r) => r.team === homeC || r.team === awayC);
  const byTeamJumper = new Map<string, string>();
  const byTeamSurname = new Map<string, string>();
  for (const r of known) {
    if (r.jumper != null) byTeamJumper.set(`${r.team}|${r.jumper}`, r.name);
    byTeamSurname.set(`${r.team}|${surname(r.name)}`, r.name);
  }

  type Row = typeof lineupPlayers.$inferInsert;
  const rows: Row[] = [];
  const dropped: string[] = [];
  const teamsSeen = new Set<string>();
  // De-dupe in case both screenshots (field + list view) name the same player.
  const seen = new Set<string>();

  for (const t of extracted.teams) {
    const team = valid.get((canonicalTeam(t.team) ?? t.team).toLowerCase());
    if (!team) {
      for (const p of t.players) dropped.push(`${p.name} (${t.team})`);
      continue;
    }
    teamsSeen.add(team);
    for (const p of t.players) {
      const resolvedName =
        (p.jumper != null ? byTeamJumper.get(`${team}|${p.jumper}`) : undefined) ??
        byTeamSurname.get(`${team}|${surname(p.name)}`) ??
        p.name;
      const dedupeKey = `${team}|${resolvedName.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({
        gameId,
        team,
        playerName: resolvedName,
        jumper: p.jumper,
        position: p.position,
        status: p.status,
        sourceUrl,
      });
    }
  }

  // Replace this game's lineup wholesale (idempotent re-upload).
  await db.delete(lineupPlayers).where(eq(lineupPlayers.gameId, gameId));
  if (rows.length > 0) {
    await db.insert(lineupPlayers).values(rows);
  }

  return {
    gameId,
    stored: rows.length,
    teams: [...teamsSeen],
    dropped,
  };
}

/**
 * Distinct players for a game's lineup — the squad seed for predictions.
 * Emergencies are excluded: they are not in the 22/23 and usually won't play.
 * Named + interchange are kept (interchange is part of the selected side).
 */
export async function getLineupNames(
  gameId: number,
): Promise<{ name: string; team: string }[]> {
  const rows = await db
    .select({
      name: lineupPlayers.playerName,
      team: lineupPlayers.team,
      status: lineupPlayers.status,
    })
    .from(lineupPlayers)
    .where(eq(lineupPlayers.gameId, gameId));
  const seen = new Set<string>();
  const out: { name: string; team: string }[] = [];
  for (const r of rows) {
    if (r.status === "emergency") continue;
    const key = `${r.name}|${r.team}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: r.name, team: r.team });
  }
  return out;
}

export type EmergencyMatcher = {
  /** True if this predicted/suggested player is an emergency for the game. */
  matches: (p: {
    name: string;
    team: string | null;
    jumper?: number | null;
  }) => boolean;
};

/**
 * Match emergencies by full name, team+surname, or team+jumper — Claude and
 * AFL Tables often disagree on first names (Nick vs Nicholas).
 */
export async function getEmergencyMatcher(
  gameId: number,
): Promise<EmergencyMatcher> {
  const rows = await db
    .select({
      name: lineupPlayers.playerName,
      team: lineupPlayers.team,
      jumper: lineupPlayers.jumper,
    })
    .from(lineupPlayers)
    .where(
      and(
        eq(lineupPlayers.gameId, gameId),
        eq(lineupPlayers.status, "emergency"),
      ),
    );

  const names = new Set(rows.map((r) => normalisePlayerName(r.name)));
  const teamSurname = new Set(
    rows.map((r) => `${canonicalTeam(r.team) ?? r.team}|${surname(r.name)}`),
  );
  const teamJumper = new Set(
    rows
      .filter((r) => r.jumper != null)
      .map((r) => `${canonicalTeam(r.team) ?? r.team}|${r.jumper}`),
  );

  return {
    matches(p) {
      if (names.has(normalisePlayerName(p.name))) return true;
      const team = p.team ? canonicalTeam(p.team) ?? p.team : null;
      if (team && teamSurname.has(`${team}|${surname(p.name)}`)) return true;
      if (
        team &&
        p.jumper != null &&
        teamJumper.has(`${team}|${p.jumper}`)
      ) {
        return true;
      }
      return false;
    },
  };
}

/** @deprecated prefer getEmergencyMatcher — kept for simple name-set callers. */
export async function getEmergencyNames(gameId: number): Promise<Set<string>> {
  const rows = await db
    .select({ name: lineupPlayers.playerName })
    .from(lineupPlayers)
    .where(
      and(
        eq(lineupPlayers.gameId, gameId),
        eq(lineupPlayers.status, "emergency"),
      ),
    );
  return new Set(rows.map((r) => normalisePlayerName(r.name)));
}

async function deletePredictionsForLineupPlayers(
  gameId: number,
  lineupRows: { name: string; team: string; jumper: number | null }[],
): Promise<number> {
  if (lineupRows.length === 0) return 0;
  const allPlayers = await db
    .select({
      id: players.id,
      name: players.name,
      team: players.team,
      jumper: players.jumper,
    })
    .from(players);

  const ids = new Set<number>();
  for (const lp of lineupRows) {
    const team = canonicalTeam(lp.team) ?? lp.team;
    const sn = surname(lp.name);
    const nn = normalisePlayerName(lp.name);
    for (const p of allPlayers) {
      const pTeam = p.team ? canonicalTeam(p.team) ?? p.team : null;
      if (pTeam !== team) continue;
      if (normalisePlayerName(p.name) === nn || surname(p.name) === sn) {
        ids.add(p.id);
        continue;
      }
      if (lp.jumper != null && p.jumper === lp.jumper) ids.add(p.id);
    }
  }
  if (ids.size === 0) return 0;
  await db
    .delete(predictions)
    .where(
      and(eq(predictions.gameId, gameId), inArray(predictions.playerId, [...ids])),
    );
  return ids.size;
}

/** Manually correct a mis-read lineup status (e.g. emergency tagged as named). */
export async function setLineupPlayerStatus(
  gameId: number,
  playerName: string,
  status: LineupStatus,
  team?: string | null,
): Promise<{ updated: number; predictionsCleared: number }> {
  const rows = await db
    .select({
      id: lineupPlayers.id,
      name: lineupPlayers.playerName,
      team: lineupPlayers.team,
      jumper: lineupPlayers.jumper,
    })
    .from(lineupPlayers)
    .where(eq(lineupPlayers.gameId, gameId));
  const target = normalisePlayerName(playerName);
  const targetSurname = surname(playerName);
  const teamC = team ? canonicalTeam(team) ?? team : null;
  const matched = rows.filter((r) => {
    if (teamC && (canonicalTeam(r.team) ?? r.team) !== teamC) return false;
    return (
      normalisePlayerName(r.name) === target || surname(r.name) === targetSurname
    );
  });
  if (matched.length === 0) return { updated: 0, predictionsCleared: 0 };

  await db
    .update(lineupPlayers)
    .set({ status })
    .where(
      inArray(
        lineupPlayers.id,
        matched.map((r) => r.id),
      ),
    );

  let predictionsCleared = 0;
  if (status === "emergency") {
    predictionsCleared = await deletePredictionsForLineupPlayers(
      gameId,
      matched.map((r) => ({ name: r.name, team: r.team, jumper: r.jumper })),
    );
  }
  return { updated: matched.length, predictionsCleared };
}

/**
 * How many lineup players are stored per game, for the given games. Lets the
 * fixtures dashboard show "lineup already uploaded" so it isn't re-done. Games
 * with no lineup are simply absent from the map.
 */
export async function getLineupCounts(
  gameIds: number[],
): Promise<Map<number, number>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select({
      gameId: lineupPlayers.gameId,
      count: sql<number>`count(*)::int`,
    })
    .from(lineupPlayers)
    .where(inArray(lineupPlayers.gameId, gameIds))
    .groupBy(lineupPlayers.gameId);
  return new Map(rows.map((r) => [r.gameId, r.count]));
}

/** The full stored lineup for a game (for display / review). */
export async function getLineup(gameId: number) {
  return db
    .select()
    .from(lineupPlayers)
    .where(eq(lineupPlayers.gameId, gameId));
}
