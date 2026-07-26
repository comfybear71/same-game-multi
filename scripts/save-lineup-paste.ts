import { readFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

import { pasteToExtractedLineup } from "../src/lib/ingest/parseLineupPaste";
import { saveLineup } from "../src/lib/ingest/lineup";
import { db } from "../src/db";
import { games } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { canonicalTeam } from "../src/lib/afl/teams";
import { selectedCount } from "../src/lib/ingest/lineupAudit";

const gameId = Number(process.argv[2] ?? 169);
const textPath = process.argv[3] ?? "src/lib/ingest/fixtures/bulldogs-richmond-r20-paste.txt";

async function main() {
  const text = readFileSync(textPath, "utf8");
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) throw new Error("game not found");
  const homeC = canonicalTeam(game.home) ?? game.home;
  const awayC = canonicalTeam(game.away) ?? game.away;
  const extracted = pasteToExtractedLineup(text, homeC, awayC);
  const result = await saveLineup(gameId, extracted, "paste:afl-match-centre");
  console.log(result);

  const rows = extracted.teams.flatMap((t) =>
    t.players.map((p) => ({
      team: t.team,
      playerName: p.name,
      jumper: p.jumper,
      status: p.status,
    })),
  );
  console.log("parsed selected", selectedCount(rows, homeC), selectedCount(rows, awayC));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
