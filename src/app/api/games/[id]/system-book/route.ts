import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  buildAndPersistSystemPortfolio,
  excludePlayerFromSystemBook,
  getSystemBook,
  previewSystemPortfolio,
  updateSystemTicketLegTarget,
  updateSystemTicketPlacement,
} from "@/lib/system/portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** List system-book tickets for a game. */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }
  try {
    const tickets = await getSystemBook(gameId);
    return NextResponse.json({ ok: true, tickets });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/** Generate / refresh system portfolio for this game (needs predictions).
 *  Body `{ preview: true }` = dry-run (H2H playbook + legs, no DB write).
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }

  let preview = false;
  try {
    const body = (await request.json()) as { preview?: boolean };
    preview = body?.preview === true;
  } catch {
    preview = false;
  }

  try {
    if (preview) {
      const result = await previewSystemPortfolio(gameId);
      if (result.tickets.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "No preview tickets — generate predictions (and upload a lineup) first, and refresh the AI policy from Strategy lab.",
            ...result,
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ ok: true, ...result });
    }

    const tickets = await buildAndPersistSystemPortfolio(gameId);
    if (tickets.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No system tickets built — generate predictions (and upload a lineup) first, and refresh the AI policy from Strategy lab.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, tickets });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * Update stake / placed odds, nudge a leg, or exclude a mis-tagged emergency.
 * Body either:
 *   { ticketId, stake?, placedOdds? }
 *   { legId, target }
 *   { excludePlayer: { playerName, team? } } — mark EMG + rebuild portfolio
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }

  let body: {
    ticketId?: number;
    stake?: number | null;
    placedOdds?: number | null;
    legId?: number;
    target?: number;
    excludePlayer?: { playerName?: string; team?: string | null };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    if (body.excludePlayer?.playerName) {
      const tickets = await excludePlayerFromSystemBook(
        gameId,
        body.excludePlayer.playerName,
        body.excludePlayer.team,
      );
      return NextResponse.json({ ok: true, tickets });
    }

    if (body.legId != null && body.target != null) {
      const ticket = await updateSystemTicketLegTarget(
        Number(body.legId),
        Number(body.target),
      );
      if (!ticket || ticket.gameId !== gameId) {
        return NextResponse.json({ error: "leg not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, ticket });
    }

    const ticketId = Number(body.ticketId);
    if (!Number.isFinite(ticketId)) {
      return NextResponse.json(
        { error: "ticketId, legId+target, or excludePlayer required" },
        { status: 400 },
      );
    }

    const parseOpt = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const ticket = await updateSystemTicketPlacement(ticketId, {
      stake: parseOpt(body.stake),
      placedOdds: parseOpt(body.placedOdds),
    });
    if (!ticket || ticket.gameId !== gameId) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ticket });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
