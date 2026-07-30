import { config } from "dotenv";
config({ path: ".env.local" });

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../src/db";
import { games, oddsSnapshots, players } from "../src/db/schema";
import { canonicalTeam } from "../src/lib/afl/teams";
import { normalisePlayerName } from "../src/lib/playerName";

function surname(name: string): string {
  const parts = normalisePlayerName(name).split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

async function main() {
  const latest = await db
    .select({ at: oddsSnapshots.snapshotAt })
    .from(oddsSnapshots)
    .orderBy(desc(oddsSnapshots.snapshotAt))
    .limit(1);

  const snapshotAt = latest[0]?.at;
  if (!snapshotAt) {
    console.log("No odds_snapshots in DB.");
    return;
  }

  console.log(`Latest harvest snapshot: ${snapshotAt.toISOString()}\n`);

  const unresolved = await db
    .select({
      playerName: oddsSnapshots.playerName,
      gameId: oddsSnapshots.gameId,
      oddsApiEventId: oddsSnapshots.oddsApiEventId,
      count: sql<number>`count(*)::int`,
    })
    .from(oddsSnapshots)
    .where(
      and(
        isNull(oddsSnapshots.playerId),
        eq(oddsSnapshots.snapshotAt, snapshotAt),
      ),
    )
    .groupBy(
      oddsSnapshots.playerName,
      oddsSnapshots.gameId,
      oddsSnapshots.oddsApiEventId,
    )
    .orderBy(sql`count(*) desc`);

  if (unresolved.length === 0) {
    console.log("All names resolved in latest snapshot.");
    return;
  }

  const gameIds = [...new Set(unresolved.map((r) => r.gameId).filter(Boolean))] as number[];
  const gameMap = new Map<number, { home: string; away: string; round: number | null }>();
  for (const id of gameIds) {
    const [g] = await db
      .select({ home: games.home, away: games.away, round: games.round })
      .from(games)
      .where(eq(games.id, id))
      .limit(1);
    if (g) gameMap.set(id, g);
  }

  const allPlayers = await db.select({ id: players.id, name: players.name, team: players.team }).from(players);

  console.log(`Unresolved names in latest snapshot: ${unresolved.length} unique (grouped by fixture)\n`);

  const byName = new Map<
    string,
    { count: number; fixtures: Set<string>; hints: string[] }
  >();

  for (const row of unresolved) {
    const g = row.gameId ? gameMap.get(row.gameId) : null;
    const fixture = g
      ? `R${g.round ?? "?"} · ${g.home} vs ${g.away} (game ${row.gameId})`
      : `event ${row.oddsApiEventId.slice(0, 8)}… (no game row)`;

    const sn = surname(row.playerName);
    const hints: string[] = [];
    if (g) {
      const homeC = canonicalTeam(g.home) ?? g.home;
      const awayC = canonicalTeam(g.away) ?? g.away;
      for (const side of [homeC, awayC]) {
        const matches = allPlayers.filter(
          (p) =>
            (p.team ? canonicalTeam(p.team) ?? p.team : "") === side &&
            surname(p.name) === sn,
        );
        for (const m of matches) hints.push(`${m.name} (${m.team}, id ${m.id})`);
      }
    }

    const prev = byName.get(row.playerName) ?? {
      count: 0,
      fixtures: new Set<string>(),
      hints: [],
    };
    prev.count += row.count;
    prev.fixtures.add(fixture);
    for (const h of hints) if (!prev.hints.includes(h)) prev.hints.push(h);
    byName.set(row.playerName, prev);
  }

  const sorted = [...byName.entries()].sort((a, b) => b[1].count - a[1].count);

  for (const [name, info] of sorted) {
    console.log(`── ${name} (×${info.count} snapshot rows)`);
    for (const f of info.fixtures) console.log(`   Fixture: ${f}`);
    if (info.hints.length > 0) {
      console.log(`   Possible DB match: ${info.hints.join(" · ")}`);
    } else {
      console.log(`   Possible DB match: (none by surname on those two clubs)`);
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
