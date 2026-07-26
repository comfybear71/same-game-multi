import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { buildLineupReview } from "@/lib/ingest/lineupReview";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
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
  const userId = Number((session.user as { id?: string }).id);
  const review = await buildLineupReview(gameId, {
    userId: Number.isFinite(userId) ? userId : null,
  });
  if (!review) {
    return NextResponse.json({ error: "game not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, review });
}
