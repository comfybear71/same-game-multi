import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getGameById } from "@/lib/data/games";
import { getLiveGameState } from "@/lib/ingest/squiggle";

// Live score/clock for a game, fresh from Squiggle (60s cache).
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = Number(params.id);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  try {
    const game = await getGameById(id);
    if (!game || game.squiggleId == null || game.season == null || game.round == null) {
      return NextResponse.json({ ok: true, state: null });
    }
    const state = await getLiveGameState(game.season, game.round, game.squiggleId);
    return NextResponse.json({
      ok: true,
      home: game.home,
      away: game.away,
      state,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
