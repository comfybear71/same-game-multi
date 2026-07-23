import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { buildHelmSuggestion } from "@/lib/predictions/helmSuggest";
import type { StatFocus } from "@/lib/predictions/suggest";
import {
  DEFAULT_LEGS,
  MAX_LEGS,
  MIN_LEGS,
} from "@/lib/predictions/suggestLimits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FOCUSES = new Set<StatFocus>([
  "any",
  "disposals",
  "marks",
  "tackles",
  "goals",
]);

/** Helm Suggest — Top-10-restricted personal multi with thinking + per-leg why. */
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
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
  const focusRaw = (url.searchParams.get("focus") ?? "any") as StatFocus;
  const focus = FOCUSES.has(focusRaw) ? focusRaw : "any";
  const legsRaw = Number(url.searchParams.get("legs") ?? DEFAULT_LEGS);
  const legs = Number.isFinite(legsRaw)
    ? Math.min(MAX_LEGS, Math.max(MIN_LEGS, Math.round(legsRaw)))
    : DEFAULT_LEGS;

  const userId = await userIdForEmail(email);

  try {
    const suggestion = await buildHelmSuggestion(gameId, focus, legs, userId);
    return NextResponse.json({ ok: true, suggestion });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
