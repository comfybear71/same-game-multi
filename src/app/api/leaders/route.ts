import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { currentSeason } from "@/lib/cron";
import {
  getStatLeaders,
  LEADER_METRICS,
  type LeaderMetric,
  type PositionBucket,
} from "@/lib/data/leaders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POSITIONS = new Set([
  "ALL",
  "KEYF",
  "FWD",
  "MID",
  "RUC",
  "DEF",
  "KEYD",
  "UNK",
]);

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const metricRaw = url.searchParams.get("metric") ?? "disposals";
  const metric = LEADER_METRICS.includes(metricRaw as LeaderMetric)
    ? (metricRaw as LeaderMetric)
    : "disposals";
  const season = Number(url.searchParams.get("season") ?? currentSeason());
  const team = url.searchParams.get("team");
  const teamB = url.searchParams.get("teamB");
  const positionRaw = url.searchParams.get("position") ?? "ALL";
  const position = POSITIONS.has(positionRaw)
    ? (positionRaw as PositionBucket | "ALL")
    : "ALL";
  const limit = Math.min(
    60,
    Math.max(5, Number(url.searchParams.get("limit") ?? 30) || 30),
  );
  const bettableOnly = url.searchParams.get("bettable") === "1";

  try {
    const rows = await getStatLeaders({
      season: Number.isFinite(season) ? season : currentSeason(),
      metric,
      team,
      teamB,
      position,
      limit,
      bettableOnly,
    });
    return NextResponse.json({
      ok: true,
      season: Number.isFinite(season) ? season : currentSeason(),
      metric,
      team,
      teamB,
      position,
      bettableOnly,
      rows,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
