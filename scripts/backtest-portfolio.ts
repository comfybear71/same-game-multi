/**
 * Greedy vs snake-draft portfolio fill comparison (λ sweep).
 *
 *   npx tsx scripts/backtest-portfolio.ts
 *   npx tsx scripts/backtest-portfolio.ts --max-games=20 --season=2026
 *
 * Writes docs/portfolio-fill-backtest.md
 * Does NOT enable PORTFOLIO_DRAFT_FILL — maintainer flips that after review.
 *
 * Actuals: prefer player_game_stats; fall back to Lab backtest_legs for the
 * same gameId (local DB often has empty player_game_stats).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "../src/db";
import {
  backtestLegs,
  backtestSlips,
  games,
  playerGameStats,
  predictions,
  type StatType,
} from "../src/db/schema";
import { getGameBenchmarkBands } from "../src/lib/data/leaders";
import type {
  FillCandidate,
  FillResult,
  PortfolioMetrics,
} from "../src/lib/system/portfolioFill";
import {
  appearanceCounts,
  loadFillPool,
  runPortfolioFill,
  strategiesToSlots,
} from "../src/lib/system/portfolioFillBridge";
import {
  loadMatchupPlaybook,
  notesToWeights,
  rankStrategiesForMatchup,
} from "../src/lib/system/playbook";
import { ensureActivePolicy, PORTFOLIO_K } from "../src/lib/system/policy";

const LAMBDAS = [4, 8, 12] as const;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

type ActualMap = Map<string, number>; // `${playerName}|${statType}` → actual

function actualKey(playerName: string, statType: string): string {
  return `${playerName.toLowerCase()}|${statType}`;
}

function actualForStat(
  row: {
    disposals: number | null;
    marks: number | null;
    tackles: number | null;
    goals: number | null;
  },
  stat: string,
): number | null {
  if (
    stat === "disposals" ||
    stat === "marks" ||
    stat === "tackles" ||
    stat === "goals"
  ) {
    return row[stat];
  }
  return null;
}

async function loadActuals(gameId: number): Promise<ActualMap> {
  const map: ActualMap = new Map();

  // Lab backtest actuals (reliable when player_game_stats is empty)
  const bt = await db
    .select({
      playerName: backtestLegs.playerName,
      statType: backtestLegs.statType,
      actualValue: backtestLegs.actualValue,
    })
    .from(backtestLegs)
    .innerJoin(backtestSlips, eq(backtestLegs.slipId, backtestSlips.id))
    .where(
      and(
        eq(backtestSlips.gameId, gameId),
        isNotNull(backtestLegs.actualValue),
      ),
    );

  for (const r of bt) {
    if (r.actualValue == null) continue;
    map.set(actualKey(r.playerName, r.statType), r.actualValue);
  }

  const pgs = await db
    .select()
    .from(playerGameStats)
    .where(eq(playerGameStats.gameId, gameId));

  for (const row of pgs) {
    for (const stat of ["disposals", "marks", "tackles", "goals"] as const) {
      const v = actualForStat(row, stat);
      if (v == null) continue;
      map.set(`id:${row.playerId}|${stat}`, v);
    }
  }

  return map;
}

function legActual(leg: FillCandidate, actuals: ActualMap): number | null {
  const byId = actuals.get(`id:${leg.playerId}|${leg.statType}`);
  if (byId != null) return byId;
  return actuals.get(actualKey(leg.playerName, leg.statType as string)) ?? null;
}

type GradeSummary = {
  tickets: number;
  slipHits: number;
  flatReturn: number;
};

function gradeFill(result: FillResult, actuals: ActualMap): GradeSummary {
  let slipHits = 0;
  let flatReturn = 0;
  let tickets = 0;

  for (const t of result.tickets) {
    if (t.legs.length === 0) continue;
    tickets++;
    let allHit = true;
    let resolved = true;
    let prodOdds = 1;
    for (const leg of t.legs) {
      const actual = legActual(leg, actuals);
      if (actual == null) {
        resolved = false;
        allHit = false;
        continue;
      }
      if (!(actual > leg.line)) allHit = false;
      prodOdds *= leg.odds ?? 1 / Math.max(leg.confidence, 0.05);
    }
    if (resolved && allHit) {
      slipHits++;
      flatReturn += prodOdds;
    }
  }

  return { slipHits, tickets, flatReturn };
}

function mostClonedKey(result: FillResult): string | null {
  const counts = appearanceCounts(result);
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      n = c;
      best = k;
    }
  }
  return n >= 2 ? best : null;
}

function clonedMissed(
  key: string | null,
  greedy: FillResult,
  actuals: ActualMap,
): boolean {
  if (!key) return false;
  const [pidStr, family] = key.split(":");
  const pid = Number(pidStr);
  for (const t of greedy.tickets) {
    if (t.isFun) continue;
    for (const l of t.legs) {
      if (l.playerId === pid && l.statFamily === family) {
        const actual = legActual(l, actuals);
        if (actual == null) return false;
        return !(actual > l.line);
      }
    }
  }
  return false;
}

async function pickGames(season: number, maxGames: number): Promise<number[]> {
  // Games with model-C preds + Lab actuals (or complete status)
  const rows = await db
    .select({
      gameId: games.id,
    })
    .from(games)
    .innerJoin(predictions, eq(predictions.gameId, games.id))
    .innerJoin(backtestSlips, eq(backtestSlips.gameId, games.id))
    .where(and(eq(games.season, season), eq(predictions.model, "C")))
    .groupBy(games.id)
    .having(sql`count(distinct ${predictions.id}) >= 20`)
    .orderBy(desc(games.commenceTime))
    .limit(maxGames);

  return rows.map((r) => r.gameId);
}

type Agg = {
  games: number;
  effBets: number;
  maxApp: number;
  overlap: number;
  ticketCount: number;
  grade: GradeSummary;
  quietNights: number;
  quietFlat: number;
};

function emptyAgg(): Agg {
  return {
    games: 0,
    effBets: 0,
    maxApp: 0,
    overlap: 0,
    ticketCount: 0,
    grade: { tickets: 0, slipHits: 0, flatReturn: 0 },
    quietNights: 0,
    quietFlat: 0,
  };
}

function addMetrics(agg: Agg, m: PortfolioMetrics, g: GradeSummary) {
  agg.games++;
  agg.effBets += m.effectiveIndependentBets;
  agg.maxApp += m.maxAppearances;
  agg.overlap += m.avgPairwiseOverlap;
  agg.ticketCount += m.ticketCount;
  agg.grade.tickets += g.tickets;
  agg.grade.slipHits += g.slipHits;
  agg.grade.flatReturn += g.flatReturn;
}

function summarise(agg: Agg) {
  const n = Math.max(agg.games, 1);
  return {
    games: agg.games,
    effBets: agg.effBets / n,
    maxApp: agg.maxApp / n,
    overlap: agg.overlap / n,
    tickets: agg.ticketCount / n,
    slipHitPct: agg.grade.tickets > 0 ? agg.grade.slipHits / agg.grade.tickets : 0,
    flatRoi:
      agg.grade.tickets > 0
        ? (agg.grade.flatReturn - agg.grade.tickets) / agg.grade.tickets
        : 0,
    quietNights: agg.quietNights,
    quietFlat: agg.quietFlat,
  };
}

async function main() {
  const season = Number(arg("season") ?? "2026");
  const maxGames = Number(arg("max-games") ?? "25");

  console.log(`\n=== Portfolio fill backtest ===`);
  console.log(`season=${season} maxGames=${maxGames} λ sweep=${LAMBDAS.join(",")}`);
  console.log(`Flag PORTFOLIO_DRAFT_FILL stays OFF — report only.\n`);

  const gameIds = await pickGames(season, maxGames);
  if (gameIds.length === 0) {
    throw new Error(
      `No games with model-C predictions + Lab backtest actuals for season ${season}`,
    );
  }
  console.log(`Games: ${gameIds.length}`);

  const policy = await ensureActivePolicy();
  const greedyAgg = emptyAgg();
  const draftByLambda = new Map<number, Agg>();
  for (const λ of LAMBDAS) draftByLambda.set(λ, emptyAgg());

  const perGameRows: string[] = [];

  for (const gameId of gameIds) {
    const [game] = await db
      .select()
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1);
    if (!game) continue;

    const playbook = await loadMatchupPlaybook(
      game.home,
      game.away,
      policy.sourceRunId,
    );
    const { selected } = rankStrategiesForMatchup(policy, playbook, PORTFOLIO_K);
    const ranked = notesToWeights(selected);
    if (ranked.length === 0) continue;

    const { bands } = await getGameBenchmarkBands(gameId);
    const pool = await loadFillPool(gameId, bands, null);
    if (pool.length < 8) {
      console.log(
        `  skip #${gameId} ${game.home} v ${game.away} — pool ${pool.length}`,
      );
      continue;
    }

    const actuals = await loadActuals(gameId);
    if (actuals.size < 10) {
      console.log(
        `  skip #${gameId} ${game.home} v ${game.away} — actuals ${actuals.size}`,
      );
      continue;
    }

    const slots = strategiesToSlots(ranked);
    const greedy = runPortfolioFill(slots, pool, "greedy");
    const gGrade = gradeFill(greedy, actuals);
    addMetrics(greedyAgg, greedy.metrics, gGrade);

    const cloneKey = mostClonedKey(greedy);
    const quiet = clonedMissed(cloneKey, greedy, actuals);
    if (quiet) {
      greedyAgg.quietNights++;
      greedyAgg.quietFlat += gGrade.flatReturn;
    }

    const drafts = new Map<number, FillResult>();
    for (const λ of LAMBDAS) {
      const draft = runPortfolioFill(slots, pool, "draft", { lambda: λ });
      drafts.set(λ, draft);
      const dGrade = gradeFill(draft, actuals);
      const agg = draftByLambda.get(λ)!;
      addMetrics(agg, draft.metrics, dGrade);
      if (quiet) {
        agg.quietNights++;
        agg.quietFlat += dGrade.flatReturn;
      }
    }

    const d8 = drafts.get(8)!;
    const d8Grade = gradeFill(d8, actuals);
    perGameRows.push(
      `| ${gameId} | ${game.home} v ${game.away} | ${greedy.metrics.effectiveIndependentBets.toFixed(2)} | ${d8.metrics.effectiveIndependentBets.toFixed(2)} | ${greedy.metrics.maxAppearances} | ${d8.metrics.maxAppearances} | ${gGrade.slipHits}/${gGrade.tickets} | ${d8Grade.slipHits}/${d8Grade.tickets} | ${quiet ? "yes" : ""} |`,
    );

    console.log(
      `  #${gameId} ${game.home} v ${game.away}: greedy eff=${greedy.metrics.effectiveIndependentBets.toFixed(2)} maxApp=${greedy.metrics.maxAppearances} hits=${gGrade.slipHits}/${gGrade.tickets}${quiet ? " QUIET-STAR" : ""}`,
    );
  }

  if (greedyAgg.games === 0) {
    throw new Error("No games graded — check predictions + Lab actuals");
  }

  const gAvg = summarise(greedyAgg);
  const draftAvgs = LAMBDAS.map((λ) => ({
    λ,
    ...summarise(draftByLambda.get(λ)!),
  }));

  // Prefer λ that clears the diversification gate, then quiet-star return,
  // then least slip-hit damage vs greedy (independence alone over-penalises).
  const clearsGate = (d: (typeof draftAvgs)[number]) =>
    d.effBets > gAvg.effBets + 0.05 && d.maxApp < gAvg.maxApp - 0.05;
  let recommended =
    draftAvgs.find(clearsGate) ??
    draftAvgs.reduce((a, b) => (a.effBets >= b.effBets ? a : b));
  for (const d of draftAvgs) {
    if (!clearsGate(d)) continue;
    if (!clearsGate(recommended)) {
      recommended = d;
      continue;
    }
    const betterQuiet = d.quietFlat > recommended.quietFlat + 0.05;
    const similarQuiet = Math.abs(d.quietFlat - recommended.quietFlat) <= 0.05;
    const betterHit = d.slipHitPct > recommended.slipHitPct + 0.005;
    if (betterQuiet || (similarQuiet && betterHit)) recommended = d;
  }

  const gateEff = recommended.effBets > gAvg.effBets + 0.05;
  const gateMax = recommended.maxApp < gAvg.maxApp - 0.05;
  const gateQuiet =
    recommended.quietNights === 0 ||
    recommended.quietFlat >= gAvg.quietFlat - 0.01;
  const pass = gateEff && gateMax;

  const lines: string[] = [];
  lines.push(`# Portfolio fill backtest — greedy vs snake draft`);
  lines.push(``);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Season:** ${season} · **Games:** ${gAvg.games}`);
  lines.push(
    `**Flag:** \`PORTFOLIO_DRAFT_FILL\` remains **OFF** — do not enable from this report.`,
  );
  lines.push(``);
  lines.push(`## Gate (HANDOFF.md)`);
  lines.push(``);
  lines.push(
    `| Check | Greedy | Best draft (λ=${recommended.λ}) | Pass? |`,
  );
  lines.push(`|-------|--------|----------------------------------|-------|`);
  lines.push(
    `| Effective independent bets ↑ | ${gAvg.effBets.toFixed(2)} | ${recommended.effBets.toFixed(2)} | ${gateEff ? "YES" : "NO"} |`,
  );
  lines.push(
    `| Max appearances ↓ | ${gAvg.maxApp.toFixed(2)} | ${recommended.maxApp.toFixed(2)} | ${gateMax ? "YES" : "NO"} |`,
  );
  lines.push(
    `| Quiet-star nights (flat $1 return) | ${gAvg.quietFlat.toFixed(2)} (${gAvg.quietNights} nights) | ${recommended.quietFlat.toFixed(2)} | ${gateQuiet ? "ok" : "watch"} |`,
  );
  lines.push(``);
  lines.push(
    `**Overall gate: ${pass ? "PASS" : "FAIL"}** — ${pass ? "ready for maintainer to consider flipping the flag" : "retune λ / wall before enabling"}.`,
  );
  lines.push(``);
  lines.push(`## λ sweep`);
  lines.push(``);
  lines.push(
    `| λ | Eff. bets | Max apps | Overlap | Slip hit | Flat ROI | Quiet-star $ |`,
  );
  lines.push(
    `|---|-----------|----------|---------|----------|----------|--------------|`,
  );
  lines.push(
    `| greedy | ${gAvg.effBets.toFixed(2)} | ${gAvg.maxApp.toFixed(2)} | ${gAvg.overlap.toFixed(3)} | ${(gAvg.slipHitPct * 100).toFixed(1)}% | ${(gAvg.flatRoi * 100).toFixed(1)}% | ${gAvg.quietFlat.toFixed(2)} |`,
  );
  for (const d of draftAvgs) {
    const mark = d.λ === recommended.λ ? " ← recommend" : "";
    lines.push(
      `| ${d.λ}${mark} | ${d.effBets.toFixed(2)} | ${d.maxApp.toFixed(2)} | ${d.overlap.toFixed(3)} | ${(d.slipHitPct * 100).toFixed(1)}% | ${(d.flatRoi * 100).toFixed(1)}% | ${d.quietFlat.toFixed(2)} |`,
    );
  }
  lines.push(``);
  lines.push(
    `**Recommended λ = ${recommended.λ}** (clears diversification gate; prefers quiet-star $ then slip hit).`,
  );
  lines.push(``);
  lines.push(`## Per-game (λ=8 sample)`);
  lines.push(``);
  lines.push(
    `| Game | Fixture | Greedy eff | Draft eff | Greedy max | Draft max | Greedy hits | Draft hits | Quiet star |`,
  );
  lines.push(
    `|------|---------|------------|-----------|------------|-----------|-------------|------------|------------|`,
  );
  lines.push(...perGameRows);
  lines.push(``);
  lines.push(`## Notes`);
  lines.push(``);
  lines.push(
    `- Exposure unit = player + market; FUN excluded from caps/metrics.`,
  );
  lines.push(
    `- Quiet-star = rounds where the most-cloned greedy exposure missed its line.`,
  );
  lines.push(
    `- Actuals from Lab \`backtest_legs\` (and \`player_game_stats\` when present).`,
  );
  lines.push(
    `- Flat ROI uses model-implied odds (no bookie prices) on $1 stakes.`,
  );
  lines.push(
    `- **Stop here.** Maintainer reviews numbers, then sets \`PORTFOLIO_DRAFT_FILL=on\` if satisfied.`,
  );
  lines.push(``);

  const outPath = join(process.cwd(), "docs", "portfolio-fill-backtest.md");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log(`Recommended λ=${recommended.λ} · Gate ${pass ? "PASS" : "FAIL"}`);
  console.log(`Do NOT enable PORTFOLIO_DRAFT_FILL from this script.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
