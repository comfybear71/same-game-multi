/**
 * Poll in-progress fixtures and upsert `player_live_stats` from AFL Match Centre.
 */

import { and, eq, gte, lte, max, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { games, playerLiveStats } from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { currentSeason } from "@/lib/cron";
import {
  aflMatchIsLiveOrPlaying,
  fetchAflMatchPlayerStats,
  fetchAflRoundMatches,
  findAflCompSeasonId,
  findAflRoundProviderId,
  getAflMediaToken,
  resolveAflMatchId,
} from "@/lib/ingest/aflMatchCentre";
import { fetchSquiggleRound, matchSquiggleFixture } from "@/lib/ingest/squiggle";

export interface LiveStatsSyncResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  gamesChecked: number;
  gamesSynced: number;
  rowsUpserted: number;
  details: Array<{ gameId: number; aflMatchId: string; players: number }>;
  errors: string[];
}

const LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

function liveStatsCronEnabled(): boolean {
  const v = process.env.LIVE_STATS_CRON?.trim().toLowerCase();
  return v !== "off" && v !== "0" && v !== "false";
}

async function upsertLiveRows(
  matchId: string,
  rows: Array<{
    playerId: string;
    playerName: string;
    team: string;
    goals: number;
    kicks: number;
    handballs: number;
    disposals: number;
    marks: number;
    tackles: number;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();
  const chunkSize = 50;
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await db
      .insert(playerLiveStats)
      .values(
        chunk.map((r) => ({
          matchId,
          playerId: r.playerId,
          playerName: r.playerName,
          team: r.team,
          goals: r.goals,
          kicks: r.kicks,
          handballs: r.handballs,
          disposals: r.disposals,
          marks: r.marks,
          tackles: r.tackles,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [playerLiveStats.matchId, playerLiveStats.playerId],
        set: {
          playerName: sql`excluded.player_name`,
          team: sql`excluded.team`,
          goals: sql`excluded.goals`,
          kicks: sql`excluded.kicks`,
          handballs: sql`excluded.handballs`,
          disposals: sql`excluded.disposals`,
          marks: sql`excluded.marks`,
          tackles: sql`excluded.tackles`,
          updatedAt: now,
        },
      });
    total += chunk.length;
  }
  return total;
}

/** Games that might be live right now (recent kickoff or in_progress). */
export async function listLiveCandidateGames(season: number) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - LIVE_WINDOW_MS);

  return db
    .select()
    .from(games)
    .where(
      and(
        eq(games.season, season),
        ne(games.status, "complete"),
        or(
          eq(games.status, "in_progress"),
          and(gte(games.commenceTime, windowStart), lte(games.commenceTime, now)),
        ),
      ),
    );
}

export async function syncLivePlayerStats(): Promise<LiveStatsSyncResult> {
  const result: LiveStatsSyncResult = {
    ok: true,
    gamesChecked: 0,
    gamesSynced: 0,
    rowsUpserted: 0,
    details: [],
    errors: [],
  };

  if (!liveStatsCronEnabled()) {
    return { ...result, skipped: true, reason: "LIVE_STATS_CRON=off" };
  }

  const season = currentSeason();
  const candidates = await listLiveCandidateGames(season);
  result.gamesChecked = candidates.length;

  if (candidates.length === 0) {
    return { ...result, skipped: true, reason: "no_live_window_games" };
  }

  const token = await getAflMediaToken();
  if (!token) {
    return { ...result, ok: false, reason: "afl_token_unavailable" };
  }

  const compSeasonId = await findAflCompSeasonId(season);
  if (!compSeasonId) {
    return { ...result, ok: false, reason: "afl_comp_season_not_found" };
  }

  const byRound = new Map<number, typeof candidates>();
  for (const g of candidates) {
    if (g.round == null) continue;
    const arr = byRound.get(g.round) ?? [];
    arr.push(g);
    byRound.set(g.round, arr);
  }

  for (const [round, roundGames] of byRound) {
    let squiggleGames: Awaited<ReturnType<typeof fetchSquiggleRound>> = [];
    try {
      squiggleGames = await fetchSquiggleRound(season, round);
    } catch (err) {
      result.errors.push(`squiggle R${round}: ${(err as Error).message}`);
      continue;
    }

    let roundProviderId: string | null = null;
    try {
      roundProviderId = await findAflRoundProviderId(compSeasonId, round);
    } catch (err) {
      result.errors.push(`afl round id R${round}: ${(err as Error).message}`);
      continue;
    }
    if (!roundProviderId) {
      result.errors.push(`afl round provider missing R${round}`);
      continue;
    }

    let aflMatches: Awaited<ReturnType<typeof fetchAflRoundMatches>> = [];
    try {
      aflMatches = await fetchAflRoundMatches(roundProviderId, token);
    } catch (err) {
      result.errors.push(`afl matchItems R${round}: ${(err as Error).message}`);
      continue;
    }

    for (const game of roundGames) {
      const sq = matchSquiggleFixture(
        squiggleGames,
        game.squiggleId,
        game.home,
        game.away,
      );
      const squiggleLive =
        sq != null && sq.game.complete > 0 && sq.game.complete < 100;
      const dbLive = game.status === "in_progress";

      const aflMatch = resolveAflMatchId(aflMatches, game.home, game.away);
      const aflLive = aflMatch != null && aflMatchIsLiveOrPlaying(aflMatch.status);

      if (!squiggleLive && !dbLive && !aflLive) continue;

      if (!aflMatch) {
        result.errors.push(`game ${game.id}: no AFL match id (${game.home} v ${game.away})`);
        continue;
      }

      try {
        const homeC = canonicalTeam(game.home) ?? game.home;
        const awayC = canonicalTeam(game.away) ?? game.away;
        const rows = await fetchAflMatchPlayerStats(
          aflMatch.aflMatchId,
          token,
          homeC,
          awayC,
        );
        if (rows.length === 0) continue;

        const n = await upsertLiveRows(aflMatch.aflMatchId, rows);
        result.gamesSynced++;
        result.rowsUpserted += n;
        result.details.push({
          gameId: game.id,
          aflMatchId: aflMatch.aflMatchId,
          players: n,
        });

        if (game.status !== "in_progress") {
          await db
            .update(games)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(games.id, game.id));
        }
      } catch (err) {
        result.errors.push(`game ${game.id}: ${(err as Error).message}`);
      }
    }
  }

  return result;
}

/** Pull Match Centre stats for one fixture (manual refresh / game page button). */
export async function syncLiveStatsForGame(
  gameId: number,
  opts?: { final?: boolean },
): Promise<LiveStatsSyncResult> {
  const result: LiveStatsSyncResult = {
    ok: true,
    gamesChecked: 1,
    gamesSynced: 0,
    rowsUpserted: 0,
    details: [],
    errors: [],
  };

  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) {
    return { ...result, ok: false, reason: "game_not_found" };
  }
  const final = opts?.final === true;
  if (game.status === "complete" && !final) {
    return { ...result, skipped: true, reason: "game_complete" };
  }
  if (game.season == null || game.round == null) {
    return { ...result, ok: false, reason: "missing_season_round" };
  }

  const token = await getAflMediaToken();
  if (!token) {
    return { ...result, ok: false, reason: "afl_token_unavailable" };
  }

  try {
    const squiggleGames = await fetchSquiggleRound(game.season, game.round);
    const sq = matchSquiggleFixture(
      squiggleGames,
      game.squiggleId,
      game.home,
      game.away,
    );
    const squiggleLive =
      sq != null && sq.game.complete > 0 && sq.game.complete < 100;

    const compSeasonId = await findAflCompSeasonId(game.season);
    if (!compSeasonId) {
      return { ...result, ok: false, reason: "afl_comp_season_not_found" };
    }
    const roundProviderId = await findAflRoundProviderId(compSeasonId, game.round);
    if (!roundProviderId) {
      return { ...result, ok: false, reason: "afl_round_not_found" };
    }
    const aflMatches = await fetchAflRoundMatches(roundProviderId, token);
    const aflMatch = resolveAflMatchId(aflMatches, game.home, game.away);
    if (!aflMatch) {
      return { ...result, ok: false, reason: "afl_match_not_found" };
    }

    const dbLive = game.status === "in_progress";
    const aflLive = aflMatchIsLiveOrPlaying(aflMatch.status);
    const now = new Date();
    const kickedOff = game.commenceTime != null && game.commenceTime <= now;
    if (!final && !squiggleLive && !dbLive && !aflLive && !kickedOff) {
      return { ...result, skipped: true, reason: "not_live_yet" };
    }

    const homeC = canonicalTeam(game.home) ?? game.home;
    const awayC = canonicalTeam(game.away) ?? game.away;
    const rows = await fetchAflMatchPlayerStats(
      aflMatch.aflMatchId,
      token,
      homeC,
      awayC,
    );
    if (rows.length === 0) {
      return { ...result, skipped: true, reason: "no_player_rows" };
    }

    const n = await upsertLiveRows(aflMatch.aflMatchId, rows);
    result.gamesSynced = 1;
    result.rowsUpserted = n;
    result.details.push({
      gameId: game.id,
      aflMatchId: aflMatch.aflMatchId,
      players: n,
    });

    if (!final && game.status !== "in_progress") {
      await db
        .update(games)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(eq(games.id, game.id));
    }
  } catch (err) {
    result.ok = false;
    result.errors.push((err as Error).message);
  }

  return result;
}

const lastSyncAttempt = new Map<number, number>();
const LIVE_SYNC_MIN_INTERVAL_MS = 45_000;
const LIVE_STATS_STALE_MS = 45_000;

/**
 * During a live game, pull fresh Match Centre rows when DB cache is empty or stale.
 * Debounced so 30s client polls do not hammer the AFL API.
 */
export async function refreshLiveStatsIfStale(gameId: number): Promise<boolean> {
  const now = Date.now();
  const lastAttempt = lastSyncAttempt.get(gameId) ?? 0;
  if (now - lastAttempt < LIVE_SYNC_MIN_INTERVAL_MS) return false;

  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game || game.status === "complete") return false;

  const kickedOff =
    game.commenceTime != null && game.commenceTime.getTime() <= now;
  if (game.status !== "in_progress" && !kickedOff) return false;

  const { resolveAflMatchIdForGame } = await import("@/lib/ingest/aflMatchForGame");
  const aflMatchId = await resolveAflMatchIdForGame(game);
  if (!aflMatchId) return false;

  const [agg] = await db
    .select({ latest: max(playerLiveStats.updatedAt) })
    .from(playerLiveStats)
    .where(eq(playerLiveStats.matchId, aflMatchId));

  const stale =
    !agg?.latest || now - agg.latest.getTime() > LIVE_STATS_STALE_MS;
  if (!stale) return false;

  lastSyncAttempt.set(gameId, now);
  await syncLiveStatsForGame(gameId);
  return true;
}
