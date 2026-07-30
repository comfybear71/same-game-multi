import { and, desc, eq, inArray, lt } from "drizzle-orm";

import { db } from "@/db";
import { games, lineupPlayers, playerGameStats } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { getPlayerBettingRecord, indexPlayerHistoryByName } from "@/lib/data/bets";
import {
  getGameBenchmarkBands,
  type BenchmarkBand,
} from "@/lib/data/leaders";
import { normalisePlayerName } from "@/lib/playerName";
import { auditLineupRows } from "@/lib/ingest/lineupAudit";
import { getLineup } from "@/lib/ingest/lineup";
import { resolveLineupPlayerIds } from "@/lib/ingest/lineupPlayerResolve";
import { normalizeLineupPosition } from "@/lib/ingest/lineupPosition";

export type LineupReviewPlayer = {
  lineupId: number;
  playerName: string;
  team: string;
  jumper: number | null;
  position: string | null;
  status: "named" | "interchange" | "emergency";
  playerId: number | null;
  /** Season disposals band (both clubs in fixture). */
  band: BenchmarkBand | "unknown" | null;
  seasonDispAvg: number | null;
  lastGameDisp: number | null;
  /** Your logged legs (all stats) for this player name. */
  pickHits: number | null;
  pickBets: number | null;
  /** Sort key within team column. */
  sortKey: number;
};

export type LineupReviewTeam = {
  team: string;
  field: LineupReviewPlayer[];
  interchange: LineupReviewPlayer[];
  emergency: LineupReviewPlayer[];
};

export type LineupReviewPayload = {
  gameId: number;
  home: string;
  away: string;
  approved: boolean;
  approvedAt: string | null;
  warnings: string[];
  teams: LineupReviewTeam[];
  summary: {
    selected: number;
    homeSelected: number;
    awaySelected: number;
    homeField: number;
    awayField: number;
    homeInt: number;
    awayInt: number;
  };
};

const FIELD_ORDER = ["FB", "HB", "C", "HF", "FF", "FOL"] as const;

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function sortKeyForPlayer(
  position: string | null,
  status: LineupReviewPlayer["status"],
  jumper: number | null,
): number {
  if (status === "emergency") return 900 + (jumper ?? 0);
  if (status === "interchange") return 800 + (jumper ?? 0);
  const code = position?.toUpperCase() ?? "";
  const idx = FIELD_ORDER.indexOf(code as (typeof FIELD_ORDER)[number]);
  if (idx >= 0) return idx * 10 + (jumper ?? 0);
  return 700 + (jumper ?? 0);
}

async function resolvePlayerIds(
  gameId: number,
  homeC: string,
  awayC: string,
): Promise<Map<number, number>> {
  return resolveLineupPlayerIds(gameId, homeC, awayC);
}

async function loadLastGameDisposals(
  playerIds: number[],
  before: Date,
): Promise<Map<number, number>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db
    .select({
      playerId: playerGameStats.playerId,
      disposals: playerGameStats.disposals,
      commenceTime: games.commenceTime,
    })
    .from(playerGameStats)
    .innerJoin(games, eq(playerGameStats.gameId, games.id))
    .where(
      and(
        inArray(playerGameStats.playerId, playerIds),
        eq(games.status, "complete"),
        lt(games.commenceTime, before),
      ),
    )
    .orderBy(desc(games.commenceTime));

  const out = new Map<number, number>();
  for (const r of rows) {
    if (out.has(r.playerId)) continue;
    if (r.disposals != null) out.set(r.playerId, r.disposals);
  }
  return out;
}

function toReviewPlayer(
  row: (typeof lineupPlayers.$inferSelect),
  playerId: number | null,
  band: BenchmarkBand | "unknown" | null,
  seasonDispAvg: number | null,
  lastGameDisp: number | null,
  pickHits: number | null,
  pickBets: number | null,
): LineupReviewPlayer {
  const position = normalizeLineupPosition(row.position);
  const status = row.status as LineupReviewPlayer["status"];
  return {
    lineupId: row.id,
    playerName: row.playerName,
    team: canonicalTeam(row.team) ?? row.team,
    jumper: row.jumper,
    position,
    status,
    playerId,
    band,
    seasonDispAvg,
    lastGameDisp,
    pickHits,
    pickBets,
    sortKey: sortKeyForPlayer(position, status, row.jumper),
  };
}

export async function buildLineupReview(
  gameId: number,
  opts?: { userId?: number | null },
): Promise<LineupReviewPayload | null> {
  const [game] = await db
    .select({
      home: games.home,
      away: games.away,
      commenceTime: games.commenceTime,
      lineupApprovedAt: games.lineupApprovedAt,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (!game) return null;

  const homeC = canonicalTeam(game.home) ?? game.home;
  const awayC = canonicalTeam(game.away) ?? game.away;
  const rows = await getLineup(gameId);
  if (rows.length === 0) {
    return {
      gameId,
      home: homeC,
      away: awayC,
      approved: false,
      approvedAt: null,
      warnings: [],
      teams: [],
      summary: { selected: 0, homeSelected: 0, awaySelected: 0, homeField: 0, awayField: 0, homeInt: 0, awayInt: 0 },
    };
  }

  const idByLineup = await resolvePlayerIds(gameId, homeC, awayC);
  const { details } = await getGameBenchmarkBands(gameId);

  const historyByName =
    opts?.userId != null
      ? indexPlayerHistoryByName((await getPlayerBettingRecord(opts.userId)).list)
      : {};

  const linkedIds = [
    ...new Set(
      rows
        .map((row) => idByLineup.get(row.id) ?? row.playerId)
        .filter((id): id is number => id != null),
    ),
  ];
  const lastDisp = await loadLastGameDisposals(
    linkedIds,
    game.commenceTime ?? new Date(),
  );

  const playersReview: LineupReviewPlayer[] = rows.map((row) => {
    const playerId = idByLineup.get(row.id) ?? row.playerId ?? null;
    let band: BenchmarkBand | "unknown" | null = null;
    let seasonDispAvg: number | null = null;
    if (playerId != null) {
      const d = details.get(`${playerId}:disposals`);
      if (d) {
        band = d.band;
        seasonDispAvg = d.average;
      } else {
        band = "unknown";
      }
    }
    const hist = historyByName[normalisePlayerName(row.playerName)];
    const pickHits = hist?.hits ?? null;
    const pickBets = hist?.bets ?? null;
    const lastGameDisp =
      playerId != null ? (lastDisp.get(playerId) ?? null) : null;
    return toReviewPlayer(
      row,
      playerId,
      band,
      seasonDispAvg,
      lastGameDisp,
      pickHits,
      pickBets,
    );
  });

  const warnings = auditLineupRows(
    rows.map((r) => ({
      team: r.team,
      playerName: r.playerName,
      jumper: r.jumper,
      status: r.status as "named" | "interchange" | "emergency",
    })),
    homeC,
    awayC,
  );

  const buildTeam = (team: string): LineupReviewTeam => {
    const mine = playersReview
      .filter((p) => p.team === team)
      .sort((a, b) => a.sortKey - b.sortKey);
    return {
      team,
      field: mine.filter((p) => p.status === "named"),
      interchange: mine.filter((p) => p.status === "interchange"),
      emergency: mine.filter((p) => p.status === "emergency"),
    };
  };

  const selected = playersReview.filter((p) => p.status !== "emergency");
  const homeSelected = selected.filter((p) => p.team === homeC).length;
  const awaySelected = selected.filter((p) => p.team === awayC).length;

  const homeTeam = buildTeam(homeC);
  const awayTeam = buildTeam(awayC);

  return {
    gameId,
    home: homeC,
    away: awayC,
    approved: game.lineupApprovedAt != null,
    approvedAt: game.lineupApprovedAt?.toISOString() ?? null,
    warnings,
    teams: [homeTeam, awayTeam],
    summary: {
      selected: selected.length,
      homeSelected,
      awaySelected,
      homeField: homeTeam.field.length,
      awayField: awayTeam.field.length,
      homeInt: homeTeam.interchange.length,
      awayInt: awayTeam.interchange.length,
    },
  };
}

export async function approveLineup(gameId: number): Promise<{
  approvedAt: string;
  review: LineupReviewPayload | null;
}> {
  const now = new Date();
  await db
    .update(games)
    .set({ lineupApprovedAt: now, updatedAt: now })
    .where(eq(games.id, gameId));
  const review = await buildLineupReview(gameId);
  return { approvedAt: now.toISOString(), review };
}

export async function clearLineupApproval(gameId: number): Promise<void> {
  await db
    .update(games)
    .set({ lineupApprovedAt: null, updatedAt: new Date() })
    .where(eq(games.id, gameId));
}

export async function isLineupApproved(gameId: number): Promise<boolean> {
  const [g] = await db
    .select({ lineupApprovedAt: games.lineupApprovedAt })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  return g?.lineupApprovedAt != null;
}
