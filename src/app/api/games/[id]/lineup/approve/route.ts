import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { approveLineup, buildLineupReview } from "@/lib/ingest/lineupReview";

export const dynamic = "force-dynamic";

export async function POST(
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
  const before = await buildLineupReview(gameId);
  if (!before || before.summary.selected === 0) {
    return NextResponse.json(
      { error: "upload a lineup before approving" },
      { status: 400 },
    );
  }
  const result = await approveLineup(gameId);
  return NextResponse.json({ ok: true, ...result });
}
