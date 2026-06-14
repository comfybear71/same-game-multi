import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { betLegs, bets, players, predictions, type StatType } from "@/db/schema";
import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";

export const dynamic = "force-dynamic";

const STATS: StatType[] = ["disposals", "marks", "tackles", "goals"];

interface IncomingLeg {
  playerName?: string;
  statType?: string;
  line?: number;
  odds?: number;
  confidence?: number;
  notes?: string;
}

interface IncomingBet {
  round?: number;
  totalOdds?: number;
  totalStake?: number;
  status?: "pending" | "won" | "lost" | "void";
  notes?: string;
  screenshotUrl?: string;
  gameId?: number;
  legs?: IncomingLeg[];
}

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Build name -> playerId lookups for players involved in a game. */
async function gamePlayerIndex(gameId: number) {
  const rows = await db
    .selectDistinct({ id: players.id, name: players.name })
    .from(predictions)
    .innerJoin(players, eq(predictions.playerId, players.id))
    .where(eq(predictions.gameId, gameId));
  const byFull = new Map<string, number>();
  const byLast = new Map<string, number>();
  for (const r of rows) {
    const n = normalise(r.name);
    byFull.set(n, r.id);
    const last = n.split(" ").slice(-1)[0];
    if (last) byLast.set(last, r.id);
  }
  return { byFull, byLast };
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = await userIdForEmail(email);
  if (!userId) {
    return NextResponse.json({ error: "user not found" }, { status: 400 });
  }

  let body: IncomingBet;
  try {
    body = (await req.json()) as IncomingBet;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const legs = (body.legs ?? []).filter(
    (l): l is IncomingLeg & { statType: StatType; line: number } =>
      STATS.includes(l.statType as StatType) && typeof l.line === "number",
  );
  if (legs.length === 0) {
    return NextResponse.json(
      { error: "at least one leg with a stat and line is required" },
      { status: 400 },
    );
  }

  const index = body.gameId ? await gamePlayerIndex(body.gameId) : null;

  try {
    const inserted = await db
      .insert(bets)
      .values({
        userId,
        round: body.round ?? null,
        totalOdds: body.totalOdds ?? null,
        totalStake: body.totalStake ?? null,
        status: body.status ?? "pending",
        notes: body.notes ?? null,
        screenshotUrl: body.screenshotUrl ?? null,
      })
      .returning({ id: bets.id });
    const betId = inserted[0].id;

    const legRows = legs.map((l) => {
      let playerId: number | null = null;
      if (index && l.playerName) {
        const n = normalise(l.playerName);
        playerId =
          index.byFull.get(n) ?? index.byLast.get(n.split(" ").slice(-1)[0]) ?? null;
      }
      return {
        betId,
        playerId,
        playerName: l.playerName ?? null,
        gameId: body.gameId ?? null,
        statType: l.statType,
        line: l.line,
        odds: l.odds ?? null,
        confidence: l.confidence ?? null,
        notes: l.notes ?? null,
      };
    });
    await db.insert(betLegs).values(legRows);

    return NextResponse.json({ ok: true, betId, legs: legRows.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
