import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { betLegs, bets, type LegResult, type StatType } from "@/db/schema";
import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { minLineTarget } from "@/lib/predictions/modelLine";
import { settleLegManually, updateLegLiveCount } from "@/lib/settle";

// Manual override for a leg that auto-settlement can't reach (unlinked
// player/game, or AFL Tables never publishing the game) — set hit/miss/void
// by hand. Scoped to the leg's owner. Pending legs can also fix stat/line.
export const dynamic = "force-dynamic";

const RESULTS: LegResult[] = ["pending", "hit", "miss", "void"];
const STATS: StatType[] = ["disposals", "marks", "tackles", "goals"];

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

  const userId = await userIdForEmail(email);
  const row = (
    await db
      .select({
        legId: betLegs.id,
        betId: betLegs.betId,
        userId: bets.userId,
        result: betLegs.result,
        statType: betLegs.statType,
        line: betLegs.line,
      })
      .from(betLegs)
      .innerJoin(bets, eq(betLegs.betId, bets.id))
      .where(eq(betLegs.id, legId))
      .limit(1)
  )[0];
  if (!row || row.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    result?: string;
    actualValue?: number | null;
    statType?: string;
    line?: number;
    target?: number;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Fix wrong stat or line on a pending leg (resets live count).
  if (
    body.result === undefined &&
    !("actualValue" in body) &&
    (body.statType !== undefined || body.line !== undefined || body.target !== undefined)
  ) {
    if (row.result !== "pending") {
      return NextResponse.json(
        { error: "can only edit stat/line on pending legs" },
        { status: 400 },
      );
    }
    const statType = (body.statType ?? row.statType) as StatType;
    if (!STATS.includes(statType)) {
      return NextResponse.json({ error: "invalid statType" }, { status: 400 });
    }
    let line: number;
    if (body.target !== undefined) {
      if (!Number.isFinite(body.target) || body.target < minLineTarget(statType)) {
        return NextResponse.json({ error: "invalid target" }, { status: 400 });
      }
      line = body.target - 0.5;
    } else if (body.line !== undefined) {
      if (!Number.isFinite(body.line)) {
        return NextResponse.json({ error: "invalid line" }, { status: 400 });
      }
      line = body.line;
    } else {
      line = row.line;
    }
    await db
      .update(betLegs)
      .set({ statType, line, actualValue: null, result: "pending" })
      .where(eq(betLegs.id, row.legId));
    return NextResponse.json({ ok: true, statType, line });
  }

  // Live in-game count — actual only, result stays pending.
  if (body.result === undefined && "actualValue" in body) {
    const v = body.actualValue;
    if (v != null && (!Number.isFinite(v) || v < 0 || !Number.isInteger(v))) {
      return NextResponse.json(
        { error: "actualValue must be a non-negative whole number or null" },
        { status: 400 },
      );
    }
    await updateLegLiveCount(row.legId, v ?? null);
    return NextResponse.json({ ok: true });
  }

  if (!RESULTS.includes(body.result as LegResult)) {
    return NextResponse.json(
      { error: `result must be one of ${RESULTS.join(", ")}` },
      { status: 400 },
    );
  }

  await settleLegManually(
    row.legId,
    row.betId,
    body.result as LegResult,
    body.actualValue ?? null,
  );
  return NextResponse.json({ ok: true });
}

/** Drop a pending leg from a slip. Deletes the slip if it was the last leg. */
export async function DELETE(
  _req: Request,
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

  const userId = await userIdForEmail(email);
  const row = (
    await db
      .select({
        legId: betLegs.id,
        betId: betLegs.betId,
        userId: bets.userId,
        result: betLegs.result,
      })
      .from(betLegs)
      .innerJoin(bets, eq(betLegs.betId, bets.id))
      .where(eq(betLegs.id, legId))
      .limit(1)
  )[0];

  if (!row || row.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (row.result !== "pending") {
    return NextResponse.json(
      { error: "only pending legs can be removed" },
      { status: 400 },
    );
  }

  await db.delete(betLegs).where(eq(betLegs.id, legId));

  const remaining = await db
    .select({ id: betLegs.id })
    .from(betLegs)
    .where(eq(betLegs.betId, row.betId));
  let betDeleted = false;
  if (remaining.length === 0) {
    await db.delete(bets).where(eq(bets.id, row.betId));
    betDeleted = true;
  }

  return NextResponse.json({ ok: true, betDeleted });
}
