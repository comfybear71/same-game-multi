import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  betLegs,
  bets,
  games,
  lineupPlayers,
  players,
  predictions,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { canonicalTeam } from "@/lib/afl/teams";
import { normalisePlayerName } from "@/lib/playerName";

export const dynamic = "force-dynamic";

async function gamePlayerIndex(gameId: number) {
  const byFull = new Map<string, number>();
  const byLast = new Map<string, number>();

  function add(id: number, name: string) {
    const n = normalisePlayerName(name);
    byFull.set(n, id);
    const last = n.split(" ").slice(-1)[0];
    if (last) byLast.set(last, id);
  }

  const predRows = await db
    .selectDistinct({ id: players.id, name: players.name })
    .from(predictions)
    .innerJoin(players, eq(predictions.playerId, players.id))
    .where(eq(predictions.gameId, gameId));
  for (const r of predRows) add(r.id, r.name);

  const lineupRows = await db
    .select({ id: lineupPlayers.playerId, name: lineupPlayers.playerName })
    .from(lineupPlayers)
    .where(eq(lineupPlayers.gameId, gameId));
  for (const r of lineupRows) {
    if (r.id != null) add(r.id, r.name);
  }

  const game = (
    await db
      .select({ home: games.home, away: games.away })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1)
  )[0];
  if (game) {
    const homeC = canonicalTeam(game.home) ?? game.home;
    const awayC = canonicalTeam(game.away) ?? game.away;
    const squadRows = await db
      .select({ id: players.id, name: players.name, team: players.team })
      .from(players);
    for (const r of squadRows) {
      if (r.team === homeC || r.team === awayC) add(r.id, r.name);
    }
  }

  return { byFull, byLast };
}

/**
 * Attach a fixture to a slip (fixes "No round" AI reads).
 * Body: { gameId: number } — sets bets.round from the fixture and legs.gameId,
 * and rematches playerIds for settlement.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const betId = Number(params.id);
  if (Number.isNaN(betId)) {
    return NextResponse.json({ error: "bad bet id" }, { status: 400 });
  }

  let body: { gameId?: number };
  try {
    body = (await req.json()) as { gameId?: number };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const gameId = Number(body.gameId);
  if (!Number.isFinite(gameId)) {
    return NextResponse.json({ error: "gameId required" }, { status: 400 });
  }

  const userId = await userIdForEmail(email);
  const row = (
    await db
      .select({ id: bets.id, userId: bets.userId })
      .from(bets)
      .where(eq(bets.id, betId))
      .limit(1)
  )[0];

  if (!row || row.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [game] = await db
    .select({
      id: games.id,
      round: games.round,
      home: games.home,
      away: games.away,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (!game) {
    return NextResponse.json({ error: "game not found" }, { status: 404 });
  }

  await db
    .update(bets)
    .set({ round: game.round })
    .where(eq(bets.id, betId));

  const index = await gamePlayerIndex(gameId);
  const legs = await db
    .select({ id: betLegs.id, playerName: betLegs.playerName })
    .from(betLegs)
    .where(eq(betLegs.betId, betId));

  for (const leg of legs) {
    let playerId: number | null = null;
    if (leg.playerName) {
      const n = normalisePlayerName(leg.playerName);
      playerId =
        index.byFull.get(n) ??
        index.byLast.get(n.split(" ").slice(-1)[0] ?? "") ??
        null;
    }
    await db
      .update(betLegs)
      .set({ gameId, playerId })
      .where(and(eq(betLegs.id, leg.id), eq(betLegs.betId, betId)));
  }

  return NextResponse.json({
    ok: true,
    betId,
    gameId,
    round: game.round,
    home: game.home,
    away: game.away,
    legsUpdated: legs.length,
  });
}

/** Remove a pending slip and its legs (cascade). */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const betId = Number(params.id);
  if (Number.isNaN(betId)) {
    return NextResponse.json({ error: "bad bet id" }, { status: 400 });
  }

  const userId = await userIdForEmail(email);
  const row = (
    await db
      .select({ id: bets.id, userId: bets.userId, status: bets.status })
      .from(bets)
      .where(eq(bets.id, betId))
      .limit(1)
  )[0];

  if (!row || row.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: "only pending slips can be deleted" },
      { status: 400 },
    );
  }

  await db.delete(bets).where(eq(bets.id, betId));
  return NextResponse.json({ ok: true });
}
