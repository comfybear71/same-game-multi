import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getBacktestLabData, type LabGameScope } from "@/lib/data/backtest";

export const dynamic = "force-dynamic";

/** Strategy lab aggregates — optional ?runId=&team= or ?teamA=&teamB= for H2H. */
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

  const teamA = url.searchParams.get("teamA") ?? undefined;
  const teamB = url.searchParams.get("teamB") ?? undefined;
  const team = url.searchParams.get("team") ?? undefined;

  let scope: LabGameScope | null = null;
  if (teamA && teamB) scope = { teamA, teamB };
  else if (team) scope = { team };

  try {
    const data = await getBacktestLabData(runId, scope);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
