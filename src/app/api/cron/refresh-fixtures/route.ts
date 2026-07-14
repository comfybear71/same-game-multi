import { NextResponse } from "next/server";

import { authorizeCron, currentSeason } from "@/lib/cron";
import { syncFixtures } from "@/lib/ingest/sync";

// Runs daily (see vercel.json). Refreshes fixtures from Squiggle.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await syncFixtures(currentSeason());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron] refresh-fixtures failed:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
