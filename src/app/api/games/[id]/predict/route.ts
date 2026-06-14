import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { syncPlayerProps } from "@/lib/ingest/props";
import { generatePredictions } from "@/lib/predictions/generate";

// Manual: fetch player props for a game (The Odds API) and generate Models
// A/B/C predictions for each propped player. Requires a signed-in user. Kept
// out of the daily cron so paid prop calls stay on-demand.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }
  try {
    const props = await syncPlayerProps(gameId);
    const gen = await generatePredictions(gameId);
    return NextResponse.json({ ok: true, props, gen });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
