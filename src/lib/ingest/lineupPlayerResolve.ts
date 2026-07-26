import { eq } from "drizzle-orm";

import { db } from "@/db";
import { lineupPlayers, players } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { getLineup } from "@/lib/ingest/lineup";
import { normalisePlayerName } from "@/lib/playerName";

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/** Map lineup_players.id → players.id (same rules as squad review). */
export async function resolveLineupPlayerIds(
  gameId: number,
  homeC: string,
  awayC: string,
): Promise<Map<number, number>> {
  const lineup = await getLineup(gameId);
  const roster = await db
    .select({
      id: players.id,
      name: players.name,
      team: players.team,
      jumper: players.jumper,
    })
    .from(players);

  const out = new Map<number, number>();
  for (const lp of lineup) {
    const team = canonicalTeam(lp.team) ?? lp.team;
    if (team !== homeC && team !== awayC) continue;
    const sn = surname(lp.playerName);
    const nn = normalisePlayerName(lp.playerName);
    for (const p of roster) {
      const pTeam = p.team ? canonicalTeam(p.team) ?? p.team : null;
      if (pTeam !== team) continue;
      if (
        normalisePlayerName(p.name) === nn ||
        (surname(p.name) === sn &&
          (lp.jumper == null ||
            p.jumper == null ||
            p.jumper === lp.jumper)) ||
        (lp.jumper != null &&
          p.jumper === lp.jumper &&
          surname(p.name) === sn)
      ) {
        out.set(lp.id, p.id);
        break;
      }
    }
  }
  return out;
}

/** Debut / not yet on AFL Tables — create a roster row so lineup can link (name + club + guernsey). */
async function ensureRosterStubsFromLineup(
  gameId: number,
  homeC: string,
  awayC: string,
): Promise<number> {
  const lineup = await getLineup(gameId);
  const roster = await db
    .select({ name: players.name, team: players.team })
    .from(players);

  let inserted = 0;
  for (const lp of lineup) {
    if (lp.status === "emergency") continue;
    const team = canonicalTeam(lp.team) ?? lp.team;
    if (team !== homeC && team !== awayC) continue;
    const parts = lp.playerName.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;

    const nn = normalisePlayerName(lp.playerName);
    const exists = roster.some((p) => {
      const pTeam = p.team ? canonicalTeam(p.team) ?? p.team : null;
      return pTeam === team && normalisePlayerName(p.name) === nn;
    });
    if (exists) continue;

    await db
      .insert(players)
      .values({
        name: lp.playerName.trim(),
        team,
        jumper: lp.jumper,
      })
      .onConflictDoNothing();
    inserted++;
    roster.push({ name: lp.playerName.trim(), team });
  }
  return inserted;
}

/** After upload, link lineup rows to `players` when roster match is unambiguous. */
export async function backfillLineupPlayerIds(
  gameId: number,
  homeC: string,
  awayC: string,
): Promise<number> {
  await ensureRosterStubsFromLineup(gameId, homeC, awayC);
  const idByLineup = await resolveLineupPlayerIds(gameId, homeC, awayC);
  let n = 0;
  for (const [lineupId, playerId] of idByLineup) {
    await db
      .update(lineupPlayers)
      .set({ playerId })
      .where(eq(lineupPlayers.id, lineupId));
    n++;
  }
  return n;
}
