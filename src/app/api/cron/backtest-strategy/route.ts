import { NextResponse } from "next/server";

import { runWeeklyStrategyLab } from "@/lib/backtest/runner";
import { authorizeCron } from "@/lib/cron";

// Monday after the round (see vercel.json): incremental Strategy lab backtest
// for the current season. Resumes `strategy-lab-{year}` so only new completed
// games are graded once AFL Tables has weekend player lines.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await runWeeklyStrategyLab({
      onProgress: (msg) => console.log(`[cron/backtest-strategy] ${msg}`),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron] backtest-strategy failed:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
