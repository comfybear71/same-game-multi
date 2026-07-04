import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { betLegs, bets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getUserBetTracker, userIdForEmail } from "@/lib/data/bets";
import { getGameById } from "@/lib/data/games";
import { runGameOverSettlement } from "@/lib/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const userId = await userIdForEmail(email);
  if (!userId) {
    return NextResponse.json({ error: "user not found" }, { status: 400 });
  }

  const game = await getGameById(gameId);
  if (!game) {
    return NextResponse.json({ error: "game not found" }, { status: 404 });
  }

  try {
    const settlement = await runGameOverSettlement(gameId);
    const legs = await getUserBetTracker(userId, gameId, game.round);

    const hit = legs.filter((l) => l.result === "hit").length;
    const miss = legs.filter((l) => l.result === "miss").length;
    const pending = legs.filter((l) => l.result === "pending").length;
    const pendingMissingCounts = legs.filter(
      (l) => l.result === "pending" && l.actualValue == null,
    ).length;

    const betIds = [...new Set(legs.map((l) => l.betId))];
    const slipRows =
      betIds.length === 0
        ? []
        : await db
            .select({ id: bets.id, status: bets.status })
            .from(bets)
            .where(inArray(bets.id, betIds));

    const slips = await Promise.all(
      slipRows.map(async (slip) => {
        const slipLegs = await db
          .select({ result: betLegs.result })
          .from(betLegs)
          .where(eq(betLegs.betId, slip.id));
        return {
          betId: slip.id,
          status: slip.status,
          hit: slipLegs.filter((l) => l.result === "hit").length,
          miss: slipLegs.filter((l) => l.result === "miss").length,
          pending: slipLegs.filter((l) => l.result === "pending").length,
          total: slipLegs.length,
        };
      }),
    );

    return NextResponse.json({
      ok: true,
      settlement,
      legs: { hit, miss, pending, pendingMissingCounts, total: legs.length },
      slips,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
