import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { games } from "@/db/schema";
import { readLineup, type LineupImage } from "@/lib/ai/readLineup";
import { auth } from "@/lib/auth";
import { canonicalTeam } from "@/lib/afl/teams";
import { env } from "@/lib/env";
import { getLineup, saveLineup } from "@/lib/ingest/lineup";

// Read a game's team sheet from one or more uploaded screenshots (AFL app /
// afl.com.au Match Centre line-ups) and store the named squad. This is the free
// replacement for the paid Odds API player list — the stored names seed
// prediction generation. Signed-in users only.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }
  const lineup = await getLineup(gameId);
  return NextResponse.json({ ok: true, lineup });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set" },
      { status: 500 },
    );
  }

  try {
    const game = (await db.select().from(games).where(eq(games.id, gameId)).limit(1))[0];
    if (!game) {
      return NextResponse.json({ error: "game not found" }, { status: 404 });
    }

    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "no file" }, { status: 400 });
    }

    // Read bytes once; upload to Blob for the audit trail and base64 for vision.
    const images: LineupImage[] = [];
    let sourceUrl: string | null = null;
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const mediaType = ALLOWED.has(file.type) ? file.type : "image/png";
      images.push({ data: bytes.toString("base64"), mediaType });
      if (env.BLOB_READ_WRITE_TOKEN) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "lineup.png";
        const blob = await put(`lineups/${gameId}-${Date.now()}-${safeName}`, bytes, {
          access: "public",
          token: env.BLOB_READ_WRITE_TOKEN,
          contentType: mediaType,
        });
        sourceUrl ??= blob.url;
      }
    }

    const extracted = await readLineup(images, {
      homeTeam: canonicalTeam(game.home) ?? game.home,
      awayTeam: canonicalTeam(game.away) ?? game.away,
    });
    const result = await saveLineup(gameId, extracted, sourceUrl);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
