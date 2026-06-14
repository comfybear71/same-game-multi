import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { currentSeason } from "@/lib/cron";
import { syncFixtures } from "@/lib/ingest/sync";

// Manual fixture sync, triggered from the UI. Requires a signed-in user.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncFixtures(currentSeason());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
