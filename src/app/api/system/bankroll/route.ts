import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getLatestBankrollSim, runBankrollSim } from "@/lib/system/bankroll";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Latest dollar bankroll walk-forward sim. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const data = await getLatestBankrollSim();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/** Re-run bankroll sim. Body optional: { sourceRunId?: number }. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let sourceRunId: number | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sourceRunId?: number;
    };
    if (body.sourceRunId != null && Number.isFinite(Number(body.sourceRunId))) {
      sourceRunId = Number(body.sourceRunId);
    }
  } catch {
    /* empty ok */
  }

  try {
    const { runId } = await runBankrollSim({ sourceRunId });
    const data = await getLatestBankrollSim();
    return NextResponse.json({ ok: true, runId, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
