import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getBacktestLabData } from "@/lib/data/backtest";

export const dynamic = "force-dynamic";

/** Strategy lab aggregates for Review — optional ?runId= to switch runs. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("runId");
  const runId = raw != null && raw !== "" ? Number(raw) : undefined;
  if (runId != null && !Number.isFinite(runId)) {
    return NextResponse.json({ error: "bad runId" }, { status: 400 });
  }

  try {
    const data = await getBacktestLabData(runId);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
