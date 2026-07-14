import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getLiveSystemBankroll } from "@/lib/system/liveBankroll";

export const dynamic = "force-dynamic";

/** Season-to-date System book cash tally (manual stake × placed odds). */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const seasonRaw = url.searchParams.get("season");
  const season =
    seasonRaw != null && Number.isFinite(Number(seasonRaw))
      ? Number(seasonRaw)
      : undefined;
  try {
    const data = await getLiveSystemBankroll(season);
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
