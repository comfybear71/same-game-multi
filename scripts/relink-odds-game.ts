/**
 * Re-resolve playerId on odds_snapshots for one game (after fix to resolvePlayer).
 * Run: npx tsx scripts/relink-odds-game.ts 170
 */
import "../src/db/loadDotenvLocal";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { games, lineupPlayers, oddsSnapshots, players } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { resolveLineupPlayerIds } from "@/lib/ingest/lineupPlayerResolve";
import {
  resolvePlayerForFixture,
  type LineupHint,
  type PlayerCandidate,
} from "@/lib/odds/resolvePlayer";

async function main() {
  const gameId = Number(process.argv[2]);
  if (!Number.isFinite(gameId)) {
    console.error("Usage: npx tsx scripts/relink-odds-game.ts <gameId>");
    process.exit(1);
  }

  const [game] = await db
    .select({ home: games.home, away: games.away })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (!game) {
    console.error("Game not found");
    process.exit(1);
  }

  const homeC = canonicalTeam(game.home) ?? game.home;
  const awayC = canonicalTeam(game.away) ?? game.away;

  const candidates: PlayerCandidate[] = await db
    .select({ id: players.id, name: players.name, team: players.team, jumper: players.jumper })
    .from(players);

  const lpRows = await db
    .select({
      id: lineupPlayers.id,
      playerName: lineupPlayers.playerName,
      team: lineupPlayers.team,
      jumper: lineupPlayers.jumper,
      playerId: lineupPlayers.playerId,
    })
    .from(lineupPlayers)
    .where(eq(lineupPlayers.gameId, gameId));

  const idByLineup = await resolveLineupPlayerIds(gameId, homeC, awayC);

  const lineup: LineupHint[] = lpRows.map((r) => ({
    playerName: r.playerName,
    team: canonicalTeam(r.team) ?? r.team,
    jumper: r.jumper,
    playerId: idByLineup.get(r.id) ?? r.playerId,
  }));

  const snaps = await db
    .select({ id: oddsSnapshots.id, playerName: oddsSnapshots.playerName, playerId: oddsSnapshots.playerId })
    .from(oddsSnapshots)
    .where(eq(oddsSnapshots.gameId, gameId));

  let updated = 0;
  let fixed = 0;
  for (const s of snaps) {
    if (!s.playerName) continue;
    const next = resolvePlayerForFixture(s.playerName, candidates, lineup, homeC, awayC);
    if (next == null || next === s.playerId) continue;
    await db.update(oddsSnapshots).set({ playerId: next }).where(eq(oddsSnapshots.id, s.id));
    updated++;
    if (s.playerId !== next) fixed++;
    if (/marshall|berry|obrien/i.test(s.playerName)) {
      console.log(`  ${s.playerName}: ${s.playerId} → ${next}`);
    }
  }
  console.log(`Done game ${gameId}: ${updated} rows updated (${fixed} changed id)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
