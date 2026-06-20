import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { cached } from "@/lib/ingest/cache";
import { explainMultis } from "@/lib/ai/explainMultis";
import { buildSuggestions, type StatFocus } from "@/lib/predictions/suggest";
import { DEFAULT_LEGS, MAX_LEGS, MIN_LEGS } from "@/lib/predictions/suggestLimits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FOCUSES: StatFocus[] = ["any", "disposals", "marks", "tackles", "goals"];

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
  const url = new URL(req.url);
  const focusParam = url.searchParams.get("focus") ?? "any";
  const focus: StatFocus = FOCUSES.includes(focusParam as StatFocus)
    ? (focusParam as StatFocus)
    : "any";
  const legsParam = Number(url.searchParams.get("legs"));
  const legCount = Number.isFinite(legsParam)
    ? Math.min(MAX_LEGS, Math.max(MIN_LEGS, Math.round(legsParam)))
    : DEFAULT_LEGS;

  const userId = await userIdForEmail(email);

  try {
    // Cache the (deterministic picks + Claude rationale) so repeated button
    // presses don't re-bill Claude. Refreshes when predictions/odds change.
    // The version segment lets a logic change invalidate stale cached results.
    // Keyed per-user since picks are nudged by that user's own bet history.
    const suggestion = await cached(
      `suggest:v4:${gameId}:${focus}:${legCount}:${userId ?? "anon"}`,
      20 * 60,
      async () =>
        explainMultis(await buildSuggestions(gameId, focus, legCount, userId)),
    );
    return NextResponse.json({ ok: true, focus, legCount, suggestion });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
