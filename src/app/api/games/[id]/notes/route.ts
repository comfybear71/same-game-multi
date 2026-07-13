import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { games } from "@/db/schema";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  matchNotes: z.string().max(8000).nullable().optional(),
});

/** PATCH match notes (preview narrative) for one fixture. */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const raw = parsed.matchNotes ?? "";
  const matchNotes = raw.trim() === "" ? null : raw.trim();

  const updated = await db
    .update(games)
    .set({ matchNotes, updatedAt: new Date() })
    .where(eq(games.id, gameId))
    .returning({ id: games.id, matchNotes: games.matchNotes });

  if (updated.length === 0) {
    return NextResponse.json({ error: "game not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, matchNotes: updated[0]!.matchNotes });
}
