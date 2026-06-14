import { NextResponse } from "next/server";

import { authorizeCron, currentSeason } from "@/lib/cron";
import { syncFixtures } from "@/lib/ingest/sync";
import { settlePendingBets } from "@/lib/settle";

// Runs daily, morning-after AWST (see vercel.json). Refreshes results from
// Squiggle, then settles any bet legs whose game is complete and has stats.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    // Pull latest results/scores first so game.status flips to complete.
    const sync = await syncFixtures(currentSeason());
    const settle = await settlePendingBets();
    return NextResponse.json({ ok: true, sync, settle });
  } catch (err) {
    console.error("[cron] settle-results failed:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
