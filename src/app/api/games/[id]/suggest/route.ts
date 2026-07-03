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
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    const build = async () =>
      explainMultis(await buildSuggestions(gameId, focus, legCount, userId));

    const suggestion = refresh
      ? await build()
      : await cached(
          `suggest:v6:${gameId}:${focus}:${legCount}:${userId ?? "anon"}`,
          20 * 60,
          build,
        );
    return NextResponse.json({ ok: true, focus, legCount, suggestion });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
