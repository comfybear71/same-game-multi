import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { betLegs, bets, type LegResult } from "@/db/schema";
import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { settleLegManually } from "@/lib/settle";

// Manual override for a leg that auto-settlement can't reach (unlinked
// player/game, or AFL Tables never publishing the game) — set hit/miss/void
// by hand. Scoped to the leg's owner.
export const dynamic = "force-dynamic";

const RESULTS: LegResult[] = ["pending", "hit", "miss", "void"];

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const legId = Number(params.id);
  if (Number.isNaN(legId)) {
    return NextResponse.json({ error: "bad leg id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as {
    result?: string;
    actualValue?: number | null;
  } | null;
  if (!body || !RESULTS.includes(body.result as LegResult)) {
    return NextResponse.json(
      { error: `result must be one of ${RESULTS.join(", ")}` },
      { status: 400 },
    );
  }

  const userId = await userIdForEmail(email);
  const row = (
    await db
      .select({ legId: betLegs.id, betId: betLegs.betId, userId: bets.userId })
      .from(betLegs)
      .innerJoin(bets, eq(betLegs.betId, bets.id))
      .where(eq(betLegs.id, legId))
      .limit(1)
  )[0];
  if (!row || row.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await settleLegManually(
    row.legId,
    row.betId,
    body.result as LegResult,
    body.actualValue ?? null,
  );
  return NextResponse.json({ ok: true });
}
