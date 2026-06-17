import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { runSettlementPipeline } from "@/lib/settle";

// Manual "Settle now" trigger — any signed-in user can run the exact same
// pipeline the daily cron runs, instead of waiting for the next morning.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSettlementPipeline();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
