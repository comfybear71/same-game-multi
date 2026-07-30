import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { getGameLiveStatsPayload } from "@/lib/data/liveStatsForGame";
import { syncLiveStatsForGame } from "@/lib/ingest/liveStatsSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
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

    const sync = await syncLiveStatsForGame(gameId);
    const payload = await getGameLiveStatsPayload(gameId, userId);

    return NextResponse.json(
      { sync, ...payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
