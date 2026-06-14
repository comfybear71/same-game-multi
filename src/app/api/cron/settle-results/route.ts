import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { games } from "@/db/schema";
import { authorizeCron, currentSeason } from "@/lib/cron";
import { settleGamePlayerStats } from "@/lib/ingest/playerStats";
import { syncFixtures } from "@/lib/ingest/sync";
import { computeRoundAccuracy } from "@/lib/predictions/accuracy";
import { settlePendingBets } from "@/lib/settle";

// Runs daily, morning-after AWST (see vercel.json):
//   1. Refresh results from Squiggle (flips games to complete + scores).
//   2. Pull actual player stats from AFL Tables for completed games.
//   3. Settle bet legs/slips against those actuals.
//   4. Recompute model accuracy for affected rounds.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const season = currentSeason();
    const sync = await syncFixtures(season);

    const completed = await db
      .select({ id: games.id, round: games.round })
      .from(games)
      .where(eq(games.status, "complete"));

    let statsRecorded = 0;
    const rounds = new Set<number>();
    for (const g of completed) {
      const res = await settleGamePlayerStats(g.id);
      statsRecorded += res.recorded;
      if (g.round != null && res.recorded > 0) rounds.add(g.round);
    }

    const settle = await settlePendingBets();

    let accuracyRows = 0;
    for (const round of rounds) {
      const acc = await computeRoundAccuracy(season, round);
      accuracyRows += acc.rowsWritten;
    }

    return NextResponse.json({
      ok: true,
      sync,
      statsRecorded,
      settle,
      accuracyRows,
    });
  } catch (err) {
    console.error("[cron] settle-results failed:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
