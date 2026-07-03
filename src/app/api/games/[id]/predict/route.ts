import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getLineupNames } from "@/lib/ingest/lineup";
import { syncPlayerProps } from "@/lib/ingest/props";
import { generatePredictions } from "@/lib/predictions/generate";

// Generate Models A/B/C from the uploaded lineup (AFL Tables stats). Optionally
// refreshes bookmaker prop lines first when ODDS_API_KEY is configured.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    if (gen.playersProcessed === 0) {
      const lineup = await getLineupNames(gameId);
      const hint =
        lineup.length === 0
          ? "Upload a lineup on the fixtures page first, then try again."
          : "Couldn't resolve players from AFL Tables — check names in the lineup.";
      return NextResponse.json({ ok: false, error: hint }, { status: 400 });
    }
    return NextResponse.json({ ok: true, props, gen });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
