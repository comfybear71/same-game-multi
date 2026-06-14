import { NextResponse } from "next/server";

import { env } from "@/lib/env";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
// configured. If we set one, require it; otherwise allow (dev convenience).
export function authorizeCron(request: Request): NextResponse | null {
  if (!env.CRON_SECRET) return null;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${env.CRON_SECRET}`) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** Current AFL season (calendar year, AWST). */
export function currentSeason(): number {
  return new Date().getUTCFullYear();
}
