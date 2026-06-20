import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { betLegs, bets, type LegResult, type StatType } from "@/db/schema";
import { db } from "@/db";
import {
  matchResultLegs,
  readBetResult,
  type StoredLegRef,
} from "@/lib/ai/readBetResult";
import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { applyResultMatches } from "@/lib/settle";

// Settle a slip from a bookmaker "Resulted" screenshot. Reads the image with
// Claude vision and matches the legs back onto this slip, but never writes a
// result on the strength of that read alone — vision can misread a tick for
// a cross just as it once misread the market's target for the achieved
// value. So the first call always comes back as an editable preview, one row
// per stored leg; the caller must POST again with `confirm` and the
// (possibly hand-corrected) `matches` to actually settle.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESULTS: LegResult[] = ["pending", "hit", "miss", "void"];

export interface LegPreview {
  legId: number;
  playerName: string | null;
  statType: StatType;
  line: number;
  result: LegResult | null; // null = AI found no match for this leg
  actualValue: number | null;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const betId = Number(params.id);
  if (Number.isNaN(betId)) {
    return NextResponse.json({ error: "bad bet id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as {
    imageUrl?: string;
    confirm?: boolean;
    matches?: { legId: number; result: LegResult; actualValue: number | null }[];
  } | null;
  if (!body?.imageUrl) {
    return NextResponse.json({ error: "imageUrl required" }, { status: 400 });
  }

  const userId = await userIdForEmail(email);
  const bet = (
    await db.select().from(bets).where(eq(bets.id, betId)).limit(1)
  )[0];
  if (!bet || bet.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const legs = await db
      .select({
        id: betLegs.id,
        playerName: betLegs.playerName,
        statType: betLegs.statType,
        line: betLegs.line,
      })
      .from(betLegs)
      .where(eq(betLegs.betId, betId));

    // Confirm pass: apply exactly the rows the caller sent back, skipping
    // any "pending" ones (left untouched on purpose) and any leg id that
    // doesn't belong to this bet. We don't re-read the image here — the
    // preview already did, and re-running it could disagree with what the
    // user just confirmed.
    if (body.confirm) {
      const legIds = new Set(legs.map((l) => l.id));
      const matches = (body.matches ?? []).filter(
        (m) =>
          legIds.has(m.legId) &&
          RESULTS.includes(m.result) &&
          m.result !== "pending",
      );
      const settle = await applyResultMatches(betId, matches, body.imageUrl);
      return NextResponse.json({ ok: true, applied: true, settle });
    }

    const extracted = await readBetResult(body.imageUrl);
    const outcome = matchResultLegs(extracted.legs, legs as StoredLegRef[]);
    const matchByLeg = new Map(outcome.matches.map((m) => [m.legId, m]));

    const preview = {
      betId: extracted.betId,
      legCount: extracted.legCount,
      legs: legs.map((leg): LegPreview => {
        const m = matchByLeg.get(leg.id);
        return {
          legId: leg.id,
          playerName: leg.playerName,
          statType: leg.statType,
          line: leg.line,
          result: m?.result ?? null,
          actualValue: m?.actualValue ?? null,
        };
      }),
    };

    return NextResponse.json({ ok: true, applied: false, needsConfirm: true, preview });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
