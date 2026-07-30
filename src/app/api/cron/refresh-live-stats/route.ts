import { NextResponse } from "next/server";

import { authorizeCron, currentSeason } from "@/lib/cron";
import { syncLivePlayerStats } from "@/lib/ingest/liveStatsSync";
import { autoSettleRecentCompleteGames } from "@/lib/settle";

// Poll AFL Match Centre during live windows (see vercel.json */2).
// After siren, auto-grade every leg from MC for fixtures in the last 12h.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const live = await syncLivePlayerStats();
    const autoSettle = await autoSettleRecentCompleteGames(currentSeason());
    return NextResponse.json({ ...live, autoSettle });
  } catch (err) {
    console.error("[cron] refresh-live-stats failed:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
