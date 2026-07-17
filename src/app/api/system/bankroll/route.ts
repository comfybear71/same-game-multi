import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  getLatestBankrollSim,
  previewBankrollSim,
  runBankrollSim,
  type BankrollSimOpts,
} from "@/lib/system/bankroll";
import type { BankrollParams } from "@/db/schema";

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

function parseBody(body: Record<string, unknown>): BankrollSimOpts {
  const params: Partial<BankrollParams> = {};
  if (body.flatStake != null && Number.isFinite(Number(body.flatStake))) {
    params.flatStake = Math.max(1, Math.min(100, Number(body.flatStake)));
  }
  if (Array.isArray(body.focuses)) {
    params.focuses = body.focuses.map(String);
  }
  if (body.minLegs != null && Number.isFinite(Number(body.minLegs))) {
    params.minLegs = Number(body.minLegs);
  }
  if (body.maxLegs != null && Number.isFinite(Number(body.maxLegs))) {
    params.maxLegs = Number(body.maxLegs);
  }
  if (typeof body.team === "string" && body.team) params.team = body.team;
  if (typeof body.teamA === "string" && body.teamA) params.teamA = body.teamA;
  if (typeof body.teamB === "string" && body.teamB) params.teamB = body.teamB;

  let sourceRunId: number | undefined;
  if (body.sourceRunId != null && Number.isFinite(Number(body.sourceRunId))) {
    sourceRunId = Number(body.sourceRunId);
  }

  const persist = body.persist === true;
  return { sourceRunId, params, persist };
}

/**
 * Preview (default) or persist bankroll sim.
 * Body: { sourceRunId?, flatStake?, focuses?, minLegs?, maxLegs?, team?, teamA?, teamB?, persist? }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let opts: BankrollSimOpts = { persist: false };
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    opts = parseBody(body);
  } catch {
    /* empty ok */
  }

  try {
    if (opts.persist) {
      const { runId, view } = await runBankrollSim({ ...opts, persist: true });
      return NextResponse.json({ ok: true, runId, ...view });
    }
    const view = await previewBankrollSim(opts);
    return NextResponse.json({ ok: true, runId: 0, ...view });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
