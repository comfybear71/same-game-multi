import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron";
import { runSettlementPipeline } from "@/lib/settle";

// Runs daily, morning-after AWST (see vercel.json):
//   1. Refresh results from Squiggle (flips games to complete + scores).
//   2. Pull actual player stats from AFL Tables for completed games.
//   3. Settle bet legs/slips against those actuals.
//   4. Recompute model accuracy for affected rounds.
// Same pipeline is exposed on-demand via POST /api/bets/settle ("Settle now").
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
