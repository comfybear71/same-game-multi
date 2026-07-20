import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron";
import { QuotaFloorError } from "@/lib/odds/quota";
import { runOddsHarvest } from "@/lib/odds/runHarvest";

/**
 * Odds API player-prop harvest (append-only odds_snapshots).
 *
 * Scheduled in vercel.json (AWST ≈ UTC+8):
 *   Wed 18:00 · Fri 18:00 · Sat 08:00 — when props usually appear pre-bounce.
 *
 * Runs whenever Vercel Cron hits this route and ODDS_API_KEY is set.
 * Kill switch: HARVEST_ODDS_CRON=off (or 0). Manual: `npm run harvest:odds`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const flag = process.env.HARVEST_ODDS_CRON?.trim().toLowerCase();
  const disabled = flag === "off" || flag === "0";
  if (disabled) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason:
        "HARVEST_ODDS_CRON=off — harvest skipped. Unset the flag or set to on to resume.",
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
