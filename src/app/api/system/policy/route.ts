import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getActivePolicy, refreshPolicy } from "@/lib/system/policy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Active AI helm policy (derived from Strategy lab). */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const policy = await getActivePolicy();
    return NextResponse.json({ ok: true, policy });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/** Refresh policy from lab. Body optional: { runId?: number }. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let runId: number | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { runId?: number };
    if (body.runId != null && Number.isFinite(Number(body.runId))) {
      runId = Number(body.runId);
    }
  } catch {
    /* empty body ok */
  }

  try {
    const policy = await refreshPolicy({ runId });
    return NextResponse.json({ ok: true, policy });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
