import { NextResponse } from "next/server";

import { readBetSlip } from "@/lib/ai/readBetSlip";
import { auth } from "@/lib/auth";
import { findGameByTeams } from "@/lib/data/games";

// Read a bet-slip image (already uploaded to Blob) with Claude vision and
// return structured legs to pre-fill the form.
export const dynamic = "force-dynamic";
// Long slip screenshots + Claude vision can exceed the default serverless budget.
export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { imageUrl } = (await req.json()) as { imageUrl?: string };
    if (!imageUrl) {
      return NextResponse.json({ error: "imageUrl required" }, { status: 400 });
    }
    const slip = await readBetSlip(imageUrl);
    // Try to link the slip to a game so legs auto-settle + show on the live panel.
    const matchedGameId = await findGameByTeams(slip.homeTeam, slip.awayTeam).catch(
      () => null,
    );
    return NextResponse.json({ ok: true, slip, matchedGameId });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
