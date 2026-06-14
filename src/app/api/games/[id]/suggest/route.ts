import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { cached } from "@/lib/ingest/cache";
import { explainMultis } from "@/lib/ai/explainMultis";
import { buildSuggestions, type StatFocus } from "@/lib/predictions/suggest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FOCUSES: StatFocus[] = ["any", "disposals", "marks", "tackles", "goals"];

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }
  const focusParam = new URL(req.url).searchParams.get("focus") ?? "any";
  const focus: StatFocus = FOCUSES.includes(focusParam as StatFocus)
    ? (focusParam as StatFocus)
    : "any";

  try {
    // Cache the (deterministic picks + Claude rationale) so repeated button
    // presses don't re-bill Claude. Refreshes when predictions/odds change.
    const suggestions = await cached(
      `suggest:${gameId}:${focus}`,
      20 * 60,
      async () => explainMultis(await buildSuggestions(gameId, focus)),
    );
    return NextResponse.json({ ok: true, focus, suggestions });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
