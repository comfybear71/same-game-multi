/**
 * Run the morning-after settlement pipeline locally (same as cron / Settle now).
 *
 *   npx tsx scripts/settle-now.ts
 *   npx tsx scripts/settle-now.ts --round=19
 *   npx tsx scripts/settle-now.ts --round=19 --lab  # force Lab + bankroll catch-up
 *   npx tsx scripts/settle-now.ts --all   # every completed game (very slow)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../src/db";
import { games, systemTickets } from "../src/db/schema";
import { currentSeason } from "../src/lib/cron";
import { pendingLegGameIds, runSettlementPipeline } from "../src/lib/settle";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function targetGameIds(opts: {
  round?: number;
  all: boolean;
}): Promise<number[]> {
  const season = currentSeason();

  if (opts.all) {
    const rows = await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.season, season), eq(games.status, "complete")));
    return rows.map((r) => r.id);
  }

  if (opts.round != null) {
    const rows = await db
      .select({ id: games.id })
      .from(games)
      .where(
        and(
          eq(games.season, season),
          eq(games.round, opts.round),
          eq(games.status, "complete"),
        ),
      );
    return rows.map((r) => r.id);
  }

  // Default: games with ungraded System tickets + personal pending legs.
  const [ungradedSystem, pendingPersonal] = await Promise.all([
    db
      .selectDistinct({ gameId: systemTickets.gameId })
      .from(systemTickets)
      .innerJoin(games, eq(games.id, systemTickets.gameId))
      .where(
        and(
          eq(games.season, season),
          isNull(systemTickets.slipHit),
          sql`${systemTickets.stake} is not null and ${systemTickets.stake} > 0`,
        ),
      ),
    pendingLegGameIds(),
  ]);

  const ids = new Set<number>([
    ...ungradedSystem.map((r) => r.gameId),
    ...pendingPersonal,
  ]);

  // If nothing pending, fall back to latest completed round.
  if (ids.size === 0) {
    const [latest] = await db
      .select({ round: games.round })
      .from(games)
      .where(and(eq(games.season, season), eq(games.status, "complete")))
      .orderBy(sql`${games.round} desc nulls last`)
      .limit(1);
    if (latest?.round != null) {
      const rows = await db
        .select({ id: games.id })
        .from(games)
        .where(
          and(
            eq(games.season, season),
            eq(games.round, latest.round),
            eq(games.status, "complete"),
          ),
        );
      return rows.map((r) => r.id);
    }
  }

  return [...ids];
}

async function main() {
  const all = process.argv.includes("--all");
  const forceLab = process.argv.includes("--lab");
  const roundRaw = arg("round");
  const round = roundRaw != null ? Number(roundRaw) : undefined;

  console.log("\n=== Settlement pipeline ===\n");

  // Always sync fixtures first so weekend games flip to complete.
  const { syncFixtures } = await import("../src/lib/ingest/sync");
  const sync = await syncFixtures(currentSeason());
  console.log(
    `Fixtures sync: upserted=${sync.upserted} skipped=${sync.skipped}`,
  );

  const gameIds = await targetGameIds({
    round: Number.isFinite(round) ? round : undefined,
    all,
  });
  console.log(
    `Settling ${gameIds.length} game(s)${round != null ? ` (round ${round})` : all ? " (all complete)" : " (open System + pending Bets)"}…\n`,
  );

  if (gameIds.length === 0) {
    console.log("No target games. Exiting.");
    return;
  }

  // Confirm status after sync
  const statuses = await db
    .select({
      id: games.id,
      home: games.home,
      away: games.away,
      status: games.status,
      round: games.round,
    })
    .from(games)
    .where(inArray(games.id, gameIds));
  for (const g of statuses) {
    console.log(
      `  #${g.id} R${g.round ?? "?"} ${g.home} v ${g.away} → ${g.status}`,
    );
  }
  console.log("");

  const completeIds = statuses
    .filter((g) => g.status === "complete")
    .map((g) => g.id);
  if (completeIds.length === 0) {
    console.log(
      "No games are complete yet after Squiggle sync. Try again later or check fixtures.",
    );
    return;
  }

  const result = await runSettlementPipeline({
    gameIds: completeIds,
    refreshLab: forceLab ? true : undefined,
  });
  console.log(
    JSON.stringify(
      {
        sync: {
          upserted: result.sync.upserted,
          skipped: result.sync.skipped,
        },
        gamesTargeted: completeIds.length,
        statsRecorded: result.statsRecorded,
        settle: result.settle,
        actualsBackfilled: result.actualsBackfilled,
        accuracyRows: result.accuracyRows,
        systemTicketsGraded: result.systemTicketsGraded,
        lab: result.lab,
        bankrollRunId: result.bankrollRunId,
      },
      null,
      2,
    ),
  );
  console.log("\nDone. Hard-refresh /system, /review, /lab, /leaders, /bets.");
  if (result.lab == null && result.statsRecorded === 0) {
    console.log(
      "(No new stats — Lab skipped. Pass --lab to force Lab + bankroll catch-up.)",
    );
  } else if (result.lab) {
    console.log(
      `Lab run #${result.lab.runId}: ${result.lab.gamesProcessed} new games · bankroll #${result.bankrollRunId ?? "—"}.`,
    );
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
