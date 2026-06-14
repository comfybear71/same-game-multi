import { NextResponse } from "next/server";

import { readBetSlip } from "@/lib/ai/readBetSlip";
import { auth } from "@/lib/auth";

// Read a bet-slip image (already uploaded to Blob) with Claude vision and
// return structured legs to pre-fill the form.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    return NextResponse.json({ ok: true, slip });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
