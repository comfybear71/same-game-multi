import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron";
import { runSettlementPipeline } from "@/lib/settle";

// Runs daily, morning-after AWST (see vercel.json):
//   1. Refresh results from Squiggle (flips games to complete + scores).
//   2. Append AFL Tables actuals for latest round (not full-season re-scrape).
//   3. Grade System book + settle personal bet legs/slips.
//   4. Recompute model accuracy for affected rounds.
//   5. When new stats land: catch up Strategy lab + bankroll (Lab page).
// Leaders / Review / System read settled tables immediately after steps 2–4.
// Same pipeline via POST /api/bets/settle and `npm run settle:now`.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await runSettlementPipeline();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron] settle-results failed:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
