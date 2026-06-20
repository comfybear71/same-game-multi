import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { cached } from "@/lib/ingest/cache";
import { listCandidateLegs } from "@/lib/predictions/suggest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Full bettable leg pool for a game, for the "+ Add player" picker on the
// suggested multi — separate from /suggest's auto-picked top N.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }

  const userId = await userIdForEmail(email);

  try {
    const legs = await cached(
      `candidates:v1:${gameId}:${userId ?? "anon"}`,
      20 * 60,
      () => listCandidateLegs(gameId, userId),
    );
    return NextResponse.json({ ok: true, legs });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
