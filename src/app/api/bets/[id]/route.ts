import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { bets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { userIdForEmail } from "@/lib/data/bets";

export const dynamic = "force-dynamic";

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
