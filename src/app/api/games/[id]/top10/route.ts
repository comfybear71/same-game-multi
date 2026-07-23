import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";
import { NO_STORE_HEADERS } from "@/lib/http/noStoreHeaders";
import { buildTop10Board } from "@/lib/predictions/top10Board";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }

  const userId = await userIdForEmail(email);

  try {
    const board = await buildTop10Board(gameId, userId);
    return NextResponse.json({ ok: true, ...board }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
