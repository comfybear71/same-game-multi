import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { betLegs, bets } from "@/db/schema";
import {
  matchResultLegs,
  readBetResult,
  type StoredLegRef,
} from "@/lib/ai/readBetResult";
import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { applyResultMatches } from "@/lib/settle";

// Settle a slip from a bookmaker "Resulted" screenshot. Reads the image with
// Claude vision, matches the legs back onto this slip, and writes their
// result + actual value. If any stored leg can't be matched we don't guess —
// we return a preview and require an explicit confirm before applying.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    const extracted = await readBetResult(body.imageUrl);
    const outcome = matchResultLegs(extracted.legs, legs as StoredLegRef[]);

    const preview = {
      betId: extracted.betId,
      legCount: extracted.legCount,
      matched: outcome.matches.length,
      total: legs.length,
      unmatchedStored: outcome.unmatchedStored.map((l) => ({
        playerName: l.playerName,
        statType: l.statType,
        line: l.line,
      })),
      legs: extracted.legs,
    };

    // Don't settle a partial/ambiguous match silently — let the user confirm.
    if (!body.confirm && outcome.unmatchedStored.length > 0) {
      return NextResponse.json({ ok: true, applied: false, needsConfirm: true, preview });
    }

    const settle = await applyResultMatches(betId, outcome.matches, body.imageUrl);
    return NextResponse.json({ ok: true, applied: true, settle, preview });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
