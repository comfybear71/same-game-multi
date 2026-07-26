import "../src/db/loadDotenvLocal";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { games } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { buildLineupCompletenessReport } from "@/lib/ingest/lineupCompleteness";
import { backfillLineupPlayerIds } from "@/lib/ingest/lineupPlayerResolve";

async function main() {
  const gameId = Number(process.argv[2] ?? 170);
  const [g] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!g) throw new Error("game not found");
  const homeC = canonicalTeam(g.home)!;
  const awayC = canonicalTeam(g.away)!;
  const n = await backfillLineupPlayerIds(gameId, homeC, awayC);
  console.log("backfilled lineup playerId on", n, "rows");
  const r = await buildLineupCompletenessReport(gameId, g.home, g.away);
  console.log(r.summary);
}

main();
