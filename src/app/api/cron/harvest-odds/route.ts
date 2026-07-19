import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron";
import { QuotaFloorError } from "@/lib/odds/quota";
import { runOddsHarvest } from "@/lib/odds/runHarvest";

/**
 * Optional Odds API harvest cron (disabled unless HARVEST_ODDS_CRON=on).
 *
 * Suggested vercel.json entries when enabling (JSON has no comments — paste in):
 *   { "path": "/api/cron/harvest-odds", "schedule": "0 10 * * 3" }  // Wed ~AWST eve
 *   { "path": "/api/cron/harvest-odds", "schedule": "0 0 * * 6" }   // Sat morning AWST
 *
 * Prefer `npm run harvest:odds` locally while watching credits this month.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const enabled =
    process.env.HARVEST_ODDS_CRON?.trim().toLowerCase() === "on" ||
    process.env.HARVEST_ODDS_CRON?.trim() === "1";
  if (!enabled) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason:
        "HARVEST_ODDS_CRON is not on. Use npm run harvest:odds, or set HARVEST_ODDS_CRON=on.",
    });
  }

  const apiKey = process.env.ODDS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "ODDS_API_KEY not set" },
      { status: 500 },
    );
  }

  try {
    const report = await runOddsHarvest({
      apiKey,
      floor: Number(process.env.ODDS_QUOTA_FLOOR ?? "50"),
      delayMs: 350,
      log: true,
    });
    return NextResponse.json({
      ok: true,
      ...report,
      unresolvedPlayers: report.unresolvedPlayers.slice(0, 50),
    });
  } catch (err) {
    if (err instanceof QuotaFloorError) {
      return NextResponse.json(
        { ok: false, error: err.message, remaining: err.remaining },
        { status: 429 },
      );
    }
    console.error("[cron] harvest-odds failed:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
