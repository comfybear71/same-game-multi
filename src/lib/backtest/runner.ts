import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  backtestLegs,
  backtestRuns,
  backtestSlips,
  games,
  type Game,
} from "@/db/schema";
import { canonicalTeam } from "@/lib/afl/teams";
import { canonicalVenue } from "@/lib/afl/venues";
import {
  buildStrategySlips,
  projectPlayerForBacktest,
} from "@/lib/backtest/engine";
import { listSeasonPlayerNames } from "@/lib/backtest/seasonPlayers";
import { getPlayerHistory } from "@/lib/ingest/aflTables";
import { syncFixtures } from "@/lib/ingest/sync";

export interface BacktestRunnerOptions {
  seasons: number[];
  label?: string;
  /** Resume an existing run id (skips games already written). */
  resumeRunId?: number;
  /** Cap games processed this invocation (smoke tests). */
  maxGames?: number;
  /** Only process this many seasons' fixtures sync (all seasons still listed). */
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

    const nameSet = new Set<string>();
    for (const season of seasons) {
      log(`Loading AFL Tables player list for ${season}…`);
      const names = await listSeasonPlayerNames(season);
      log(`  ${season}: ${names.length} players`);
      for (const n of names) nameSet.add(n);
    }
    const allNames = [...nameSet];
    log(`Fetching histories for ${allNames.length} players (cached)…`);

    const histories = new Map<string, Awaited<ReturnType<typeof getPlayerHistory>>>();
    await mapLimit(allNames, 6, async (name) => {
      const h = await getPlayerHistory(name);
      if (h.gameLog.length > 0) histories.set(name, h);
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

    for (const game of limit) {
      const season = game.season!;
      const homeC = canonicalTeam(game.home) ?? game.home;
      const awayC = canonicalTeam(game.away) ?? game.away;
      const venue = canonicalVenue(game.venue);
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
        );
        const vsAway = projectPlayerForBacktest(
          name,
          homeC,
          history,
          season,
          game.round,
          awayC,
          venue,
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
