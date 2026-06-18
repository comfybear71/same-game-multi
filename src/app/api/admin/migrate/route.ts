import { NextResponse } from "next/server";

import { runMigrations } from "@/db/runMigrations";
import { auth } from "@/lib/auth";

// Apply pending DB migrations from the running app — handy when deploying from
// a phone with no terminal. Any signed-in (allowlisted) user can trigger it,
// same trust level as "Settle now". Runs at runtime over Neon's serverless
// driver and reports the real error on failure instead of failing a build.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runMigrations();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
