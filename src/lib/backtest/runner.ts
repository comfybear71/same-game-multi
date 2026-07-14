import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  backtestLegs,
  backtestRuns,
  backtestSlips,
  games,
  players,
  type Game,
} from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { canonicalVenue } from "@/lib/afl/venues";
import {
  buildStrategySlips,
  projectPlayerForBacktest,
} from "@/lib/backtest/engine";
import {
  listSeasonPlayers,
  type SeasonPlayerRef,
} from "@/lib/backtest/seasonPlayers";
import { currentSeason } from "@/lib/cron";
import { getPlayerHistory } from "@/lib/ingest/aflTables";
import { syncFixtures } from "@/lib/ingest/sync";

/** Stable label for the Monday weekly Strategy lab cron (current season). */
export function weeklyLabLabel(season = currentSeason()): string {
  return `strategy-lab-${season}`;
}

export interface BacktestRunnerOptions {
  seasons: number[];
  label?: string;
  /** Resume an existing run id (skips games already written). */
  resumeRunId?: number;
  /** Cap games processed this invocation (smoke tests). */
  maxGames?: number;
  onProgress?: (msg: string) => void;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () => worker()),
  );
  return results;
}

async function loadCompletedGames(seasons: number[]): Promise<Game[]> {
  return db
    .select()
    .from(games)
    .where(and(inArray(games.season, seasons), eq(games.status, "complete")))
    .orderBy(asc(games.commenceTime), asc(games.id));
}

/**
 * Walk-forward SGM strategy backtest for the given seasons.
 * Syncs Squiggle fixtures, seeds player names from AFL Tables season pages,
 * then for each completed game builds the strategy matrix and grades legs.
 */
export async function runBacktest(opts: BacktestRunnerOptions): Promise<{
  runId: number;
  gamesProcessed: number;
  slipsWritten: number;
}> {
  const log = opts.onProgress ?? console.log;
  const seasons = [...opts.seasons].sort((a, b) => a - b);

  let runId = opts.resumeRunId;
  // Same label → resume the latest run (keeps weekly `strategy-lab-*` unique).
  if (runId == null && opts.label) {
    const existing = await db
      .select({ id: backtestRuns.id })
      .from(backtestRuns)
      .where(eq(backtestRuns.label, opts.label))
      .orderBy(desc(backtestRuns.startedAt))
      .limit(1);
    if (existing[0]) runId = existing[0].id;
  }

  if (runId == null) {
    const [row] = await db
      .insert(backtestRuns)
      .values({
        label: opts.label ?? `sgm-${seasons.join("-")}`,
        seasons,
        status: "running",
      })
      .returning({ id: backtestRuns.id });
    runId = row!.id;
    log(`Created backtest run #${runId}`);
  } else {
    log(`Resuming backtest run #${runId}`);
    await db
      .update(backtestRuns)
      .set({ status: "running", error: null })
      .where(eq(backtestRuns.id, runId));
  }

  try {
    for (const season of seasons) {
      log(`Syncing Squiggle fixtures for ${season}…`);
      const sync = await syncFixtures(season);
      log(`  ${season}: upserted ${sync.upserted}, skipped ${sync.skipped}`);
    }

    /** Prefer AFL Tables slug when we have one (handles OBrien / Hamill1). */
    const byKey = new Map<string, SeasonPlayerRef>();
    for (const season of seasons) {
      log(`Loading AFL Tables player list for ${season}…`);
      try {
        const refs = await listSeasonPlayers(season);
        log(`  ${season}: ${refs.length} players`);
        for (const ref of refs) {
          const key = ref.slug.toLowerCase();
          if (!byKey.has(key)) byKey.set(key, ref);
        }
      } catch (err) {
        log(`  ${season}: failed (${(err as Error).message})`);
      }
    }
    // Only if AFL Tables returned nothing: fall back to DB lineup-seeded names.
    if (byKey.size === 0) {
      const dbPlayers = await db
        .select({ name: players.name, slug: players.aflTablesSlug })
        .from(players);
      for (const p of dbPlayers) {
        const key = (p.slug ?? p.name).toLowerCase();
        byKey.set(key, { name: p.name, slug: p.slug ?? "" });
      }
      log(`AFL Tables empty — using ${dbPlayers.length} players from DB`);
    }
    const pool = [...byKey.values()];
    log(`Player pool: ${pool.length}`);

    if (pool.length === 0) {
      throw new Error(
        "No player names found from AFL Tables or DB — cannot backtest.",
      );
    }
    log(`Fetching histories for ${pool.length} players (cached)…`);

    const histories = new Map<string, Awaited<ReturnType<typeof getPlayerHistory>>>();
    await mapLimit(pool, 6, async (ref) => {
      const h = await getPlayerHistory(ref.name, ref.slug || null);
      if (h.gameLog.length > 0) histories.set(ref.name, h);
      return null;
    });
    log(`  histories ready: ${histories.size}`);

    const completed = await loadCompletedGames(seasons);
    const already = await db
      .select({ gameId: backtestSlips.gameId })
      .from(backtestSlips)
      .where(eq(backtestSlips.runId, runId));
    const doneIds = new Set(already.map((r) => r.gameId));

    const [priorCounts] = await db
      .select({
        games: backtestRuns.gamesProcessed,
        slips: backtestRuns.slipsWritten,
      })
      .from(backtestRuns)
      .where(eq(backtestRuns.id, runId))
      .limit(1);

    let gamesProcessed = 0;
    let slipsWritten = priorCounts?.slips ?? 0;
    const pending = completed.filter((g) => !doneIds.has(g.id));
    const limit = opts.maxGames != null ? pending.slice(0, opts.maxGames) : pending;
    log(`Games to process: ${limit.length} (${doneIds.size} already done)`);

    /** Squiggle R0 = Opening Round; AFL Tables numbers those seasons +1. */
    const openingBySeason = new Map<number, boolean>();
    for (const g of completed) {
      if (g.season == null) continue;
      if (g.round === 0) openingBySeason.set(g.season, true);
      else if (!openingBySeason.has(g.season)) openingBySeason.set(g.season, false);
    }

    for (const game of limit) {
      const season = game.season!;
      const homeC = canonicalTeam(game.home) ?? game.home;
      const awayC = canonicalTeam(game.away) ?? game.away;
      const venue = canonicalVenue(game.venue);
      const hasOpening = openingBySeason.get(season) ?? false;
      const allCandidates = [];

      for (const [name, history] of histories) {
        // Player must have played for one of the two sides that day.
        const vsHome = projectPlayerForBacktest(
          name,
          awayC,
          history,
          season,
          game.round,
          homeC,
          venue,
          hasOpening,
        );
        const vsAway = projectPlayerForBacktest(
          name,
          homeC,
          history,
          season,
          game.round,
          awayC,
          venue,
          hasOpening,
        );
        // If they faced home, they were on the away team (opponent = home).
        const projected = vsHome ?? vsAway;
        if (!projected) continue;
        // Fix team: opponent in log is the other side.
        const team = vsHome ? awayC : homeC;
        for (const c of projected.candidates) {
          allCandidates.push({ ...c, team });
        }
      }

      const slips = buildStrategySlips(allCandidates);
      for (const slip of slips) {
        const [inserted] = await db
          .insert(backtestSlips)
          .values({
            runId,
            gameId: game.id,
            season,
            round: game.round,
            strategyKey: slip.strategyKey,
            focus: slip.focus,
            legCount: slip.legCount,
            modelledChance: slip.modelledChance,
            estOdds: slip.estOdds,
            legsHit: slip.legsHit,
            legsTotal: slip.legsTotal,
            slipHit: slip.slipHit,
            flatReturn: slip.flatReturn,
          })
          .returning({ id: backtestSlips.id });

        if (slip.legs.length > 0) {
          await db.insert(backtestLegs).values(
            slip.legs.map((l) => ({
              slipId: inserted!.id,
              playerName: l.playerName,
              team: l.team,
              statType: l.statType,
              line: l.line,
              prediction: l.prediction,
              confidence: l.confidence,
              actualValue: l.actualValue,
              hit: l.hit,
            })),
          );
        }
        slipsWritten++;
      }

      gamesProcessed++;
      await db
        .update(backtestRuns)
        .set({
          gamesProcessed: doneIds.size + gamesProcessed,
          slipsWritten,
          lastGameId: game.id,
        })
        .where(eq(backtestRuns.id, runId));

      if (gamesProcessed % 5 === 0 || gamesProcessed === limit.length) {
        log(
          `  ${homeC} vs ${awayC} R${game.round} ${season}: ${allCandidates.length} legs, ${slips.length} slips (${gamesProcessed}/${limit.length})`,
        );
      }
    }

    await db
      .update(backtestRuns)
      .set({
        status: "complete",
        finishedAt: new Date(),
        gamesProcessed: doneIds.size + gamesProcessed,
        slipsWritten,
      })
      .where(eq(backtestRuns.id, runId));

    log(`Done run #${runId}: ${gamesProcessed} games, ${slipsWritten} slips`);
    return { runId, gamesProcessed, slipsWritten };
  } catch (err) {
    await db
      .update(backtestRuns)
      .set({
        status: "failed",
        error: (err as Error).message,
        finishedAt: new Date(),
      })
      .where(eq(backtestRuns.id, runId));
    throw err;
  }
}

/**
 * Monday weekly Strategy lab: resume (or create) `strategy-lab-{season}` and
 * process any newly completed games. Squiggle marks fixtures complete; AFL
 * Tables supplies player lines (usually caught up by Monday AWST).
 */
export async function runWeeklyStrategyLab(opts?: {
  season?: number;
  onProgress?: (msg: string) => void;
}): Promise<{
  runId: number;
  gamesProcessed: number;
  slipsWritten: number;
  created: boolean;
}> {
  const season = opts?.season ?? currentSeason();
  const label = weeklyLabLabel(season);
  const log = opts?.onProgress ?? console.log;

  const existing = await db
    .select({ id: backtestRuns.id })
    .from(backtestRuns)
    .where(eq(backtestRuns.label, label))
    .orderBy(desc(backtestRuns.startedAt))
    .limit(1);

  const resumeRunId = existing[0]?.id;
  const created = resumeRunId == null;
  if (created) {
    log(`No weekly lab run for ${label} — creating.`);
  } else {
    log(`Resuming weekly lab run #${resumeRunId} (${label}).`);
  }

  const result = await runBacktest({
    seasons: [season],
    label,
    resumeRunId,
    onProgress: log,
  });

  return { ...result, created };
}
