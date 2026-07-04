import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { games } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getGameById } from "@/lib/data/games";
import { resolveLiveGameState } from "@/lib/ingest/squiggle";
import { hasRealScores } from "@/lib/scoreDisplay";
// Live score/clock for a game, fresh from Squiggle (15s cache).
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = Number(params.id);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  try {
    const game = await getGameById(id);
    if (!game) {
      return NextResponse.json({ ok: true, state: null });
    }

    let state: {
      status: "scheduled" | "live" | "final";
      timestr: string | null;
      homeScore: number | null;
      awayScore: number | null;
      complete: number;
    } | null = null;
    let resolvedSquiggleId: number | undefined;

    if (game.season != null && game.round != null) {
      try {
        const resolved = await resolveLiveGameState(
          game.season,
          game.round,
          game.squiggleId,
          game.home,
          game.away,
        );
        if (resolved) {
          resolvedSquiggleId = resolved.squiggleId;
          state = {
            status: resolved.status,
            timestr: resolved.timestr,
            homeScore: resolved.homeScore,
            awayScore: resolved.awayScore,
            complete: resolved.complete,
          };
        }
      } catch (err) {
        console.warn(`[live] Squiggle failed for game ${id}:`, err);
      }
    }

    const kickedOff = game.commenceTime.getTime() <= Date.now();
    if (
      !state &&
      kickedOff &&
      game.status !== "complete" &&
      hasRealScores(game.homeScore, game.awayScore)
    ) {
      state = {
        status: "live" as const,
        timestr: null,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        complete: 50,
      };
    }

    if (state && hasRealScores(state.homeScore, state.awayScore, state.complete)) {
      void db
        .update(games)
        .set({
          homeScore: state.homeScore,
          awayScore: state.awayScore,
          status: state.status === "final" ? "complete" : "in_progress",
          ...(resolvedSquiggleId != null ? { squiggleId: resolvedSquiggleId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(games.id, id))
        .catch((err) => console.warn(`[live] DB score update failed for ${id}:`, err));
    } else if (resolvedSquiggleId != null && resolvedSquiggleId !== game.squiggleId) {
      void db
        .update(games)
        .set({ squiggleId: resolvedSquiggleId, updatedAt: new Date() })
        .where(eq(games.id, id))
        .catch((err) => console.warn(`[live] squiggleId fix failed for ${id}:`, err));
    }

    return NextResponse.json(
      {
        ok: true,
        home: game.home,
        away: game.away,
        state,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
