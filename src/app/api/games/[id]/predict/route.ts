import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { NO_STORE_HEADERS } from "@/lib/http/noStoreHeaders";
import { getLineupNames } from "@/lib/ingest/lineup";
import { generatePredictions } from "@/lib/predictions/generate";
import { buildTop10Board } from "@/lib/predictions/top10Board";

// Generate Models A/B/C from the uploaded lineup (AFL Tables stats).
export const dynamic = "force-dynamic";
export const revalidate = 0;
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
    const gen = await generatePredictions(gameId);
    if (gen.playersProcessed === 0) {
      const lineup = await getLineupNames(gameId);
      const hint =
        lineup.length === 0
          ? "Upload a lineup on the fixtures page first, then try again."
          : "Couldn't resolve players from AFL Tables — check names in the lineup.";
      return NextResponse.json({ ok: false, error: hint }, { status: 400 });
    }
    const email = session.user.email;
    const userId = email ? await userIdForEmail(email) : null;
    const top10 = await buildTop10Board(gameId, userId);
    return NextResponse.json({ ok: true, gen, top10 }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
