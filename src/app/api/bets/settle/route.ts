import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { pendingLegGameIds, runSettlementPipeline } from "@/lib/settle";

// Manual "Settle now" trigger — any signed-in user can run the same pipeline
// the daily cron runs, instead of waiting for the next morning. Scoped to just
// the games referenced by still-pending legs so it finishes inside the
// serverless time limit (the full-season sweep is left to the cron).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const gameIds = await pendingLegGameIds();
    const result = await runSettlementPipeline({ gameIds });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
