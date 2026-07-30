import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getGameLiveStatsPayload } from "@/lib/data/liveStatsForGame";
import { preflightLiveStats } from "@/lib/data/liveStatsPreflight";
import { userIdForEmail } from "@/lib/data/bets";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  try {
    const userId = await userIdForEmail(session.user.email);
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const payload = await getGameLiveStatsPayload(gameId, userId);
    const preflight =
      payload.gameComplete ? null : await preflightLiveStats(gameId);
    return NextResponse.json(
      preflight != null ? { ...payload, preflight } : payload,
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
