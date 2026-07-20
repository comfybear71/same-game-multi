/**
 * System book v2 gate: live draft vs draft + satellite-1 + edge + leaders.
 *
 *   npx tsx scripts/backtest-portfolio-edge.ts
 *   npx tsx scripts/backtest-portfolio-edge.ts --max-games=20 --season=2026
 *
 * Writes docs/portfolio-edge-backtest.md
 * Does NOT enable PORTFOLIO_EDGE_SCORE — maintainer flips after review.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "../src/db";
import {
  backtestLegs,
  backtestSlips,
  games,
  playerGameStats,
  predictions,
} from "../src/db/schema";
import { getGameBenchmarkBands } from "../src/lib/data/leaders";
import { DEFAULT_EDGE_WEIGHTS } from "../src/lib/system/edgeScore";
import type {
  FillCandidate,
  FillResult,
  PortfolioMetrics,
} from "../src/lib/system/portfolioFill";
import {
  loadFillPool,
  runPortfolioFillExplicit,
  strategiesToSlots,
} from "../src/lib/system/portfolioFillBridge";
import {
  loadMatchupPlaybook,
  notesToWeights,
  rankStrategiesForMatchup,
} from "../src/lib/system/playbook";
import { ensureActivePolicy, PORTFOLIO_K } from "../src/lib/system/policy";

const LAMBDAS = [4, 8, 12] as const;
const EDGE_WEIGHTS = [30, 50, 80] as const;
const LEADER_WEIGHTS = [3, 6, 10] as const;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

type ActualMap = Map<string, number>;

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

  const pgs = await db.select().from(playerGameStats).where(eq(playerGameStats.gameId, gameId));
  for (const row of pgs) {
    for (const stat of ["disposals", "marks", "tackles", "goals"] as const) {
      const v = actualForStat(row, stat);
      if (v == null) continue;
      map.set(`id:${row.playerId}|${stat}`, v);
    }
  }
  return map;
}

function legCleared(
  leg: FillCandidate,
  actuals: ActualMap,
): boolean | null {
  const byId = actuals.get(`id:${leg.playerId}|${leg.statFamily}`);
  const byName = actuals.get(actualKey(leg.playerName, leg.statFamily));
  const actual = byId ?? byName;
  if (actual == null) return null;
  return actual > leg.line;
}

function gradeFill(result: FillResult, actuals: ActualMap) {
  let tickets = 0;
  let slipHits = 0;
  let flatReturn = 0;
  for (const t of result.tickets) {
    if (t.isFun || t.legs.length === 0) continue;
    tickets++;
    let allHit = true;
    let known = 0;
    for (const l of t.legs) {
      const hit = legCleared(l, actuals);
      if (hit == null) {
        allHit = false;
        continue;
      }
      known++;
      if (!hit) allHit = false;
    }
    if (known === 0) continue;
    const estOdds = t.legs.reduce((acc, l) => {
      const p = Math.max(0.05, Math.min(0.95, l.confidence));
      return acc * (1 / p);
    }, 1);
    if (allHit && known === t.legs.length) {
      slipHits++;
      flatReturn += estOdds;
    }
  }
  return { tickets, slipHits, flatReturn };
}

function mostClonedKey(result: FillResult): string | null {
  const counts = new Map<string, number>();
  for (const t of result.tickets) {
    if (t.isFun) continue;
    for (const l of t.legs) {
      const k = `${l.playerId}:${l.statFamily}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
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
  result: FillResult,
  actuals: ActualMap,
): boolean {
  if (!key) return false;
  const [pid, family] = key.split(":");
  for (const t of result.tickets) {
    if (t.isFun) continue;
    for (const l of t.legs) {
      if (String(l.playerId) !== pid || l.statFamily !== family) continue;
      const hit = legCleared(l, actuals);
      if (hit === false) return true;
    }
  }
  return false;
}

type Agg = {
  games: number;
  effBets: number;
  maxApp: number;
  overlap: number;
  ticketCount: number;
  quietNights: number;
  quietFlat: number;
  grade: { tickets: number; slipHits: number; flatReturn: number };
};

function emptyAgg(): Agg {
  return {
    games: 0,
    effBets: 0,
    maxApp: 0,
    overlap: 0,
    ticketCount: 0,
    quietNights: 0,
    quietFlat: 0,
    grade: { tickets: 0, slipHits: 0, flatReturn: 0 },
  };
}

function addMetrics(agg: Agg, m: PortfolioMetrics, grade: ReturnType<typeof gradeFill>) {
  agg.games++;
  agg.effBets += m.effectiveIndependentBets;
  agg.maxApp += m.maxAppearances;
  agg.overlap += m.avgPairwiseOverlap;
  agg.ticketCount += m.ticketCount;
  agg.grade.tickets += grade.tickets;
  agg.grade.slipHits += grade.slipHits;
  agg.grade.flatReturn += grade.flatReturn;
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

async function pickGames(season: number, maxGames: number): Promise<number[]> {
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .innerJoin(predictions, eq(predictions.gameId, games.id))
    .where(
      and(
        eq(games.season, season),
        eq(games.status, "complete"),
        eq(predictions.model, "C"),
      ),
    )
    .groupBy(games.id)
    .having(sql`count(*) >= 20`)
    .orderBy(sql`${games.commenceTime} desc`)
    .limit(maxGames);
  return rows.map((r) => r.id);
}

async function main() {
  const season = Number(arg("season") ?? "2026");
  const maxGames = Number(arg("max-games") ?? "25");

  console.log(`\n=== Portfolio edge package backtest ===`);
  console.log(`season=${season} maxGames=${maxGames}`);
  console.log(`Flag PORTFOLIO_EDGE_SCORE stays OFF — report only.\n`);

  const gameIds = await pickGames(season, maxGames);
  if (gameIds.length === 0) {
    throw new Error(`No games for season ${season}`);
  }
  console.log(`Games: ${gameIds.length}`);

  const policy = await ensureActivePolicy();
  const liveAgg = emptyAgg();
  const v2Agg = emptyAgg();
  const lambdaSweep = new Map<number, Agg>();
  for (const λ of LAMBDAS) lambdaSweep.set(λ, emptyAgg());
  const edgeSweep = new Map<number, Agg>();
  for (const w of EDGE_WEIGHTS) edgeSweep.set(w, emptyAgg());
  const leaderSweep = new Map<number, Agg>();
  for (const w of LEADER_WEIGHTS) leaderSweep.set(w, emptyAgg());

  const perGameRows: string[] = [];

  for (const gameId of gameIds) {
    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
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
    const livePool = await loadFillPool(gameId, bands, null, {
      edgePackage: false,
    });
    if (livePool.length < 8) {
      console.log(`  skip #${gameId} pool ${livePool.length}`);
      continue;
    }

    const actuals = await loadActuals(gameId);
    if (actuals.size < 10) {
      console.log(`  skip #${gameId} actuals ${actuals.size}`);
      continue;
    }

    const slots = strategiesToSlots(ranked);
    const live = runPortfolioFillExplicit(slots, livePool, "draft", {
      edgePackage: false,
      lambda: 4,
    });
    const liveGrade = gradeFill(live, actuals);
    addMetrics(liveAgg, live.metrics, liveGrade);

    const cloneKey = mostClonedKey(live);
    const quiet = clonedMissed(cloneKey, live, actuals);
    if (quiet) {
      liveAgg.quietNights++;
      liveAgg.quietFlat += liveGrade.flatReturn;
    }

    // Default v2 weights
    const v2Pool = await loadFillPool(gameId, bands, null, {
      edgePackage: true,
      edgeWeights: DEFAULT_EDGE_WEIGHTS,
    });
    const v2 = runPortfolioFillExplicit(slots, v2Pool, "draft", {
      edgePackage: true,
      lambda: 4,
    });
    const v2Grade = gradeFill(v2, actuals);
    addMetrics(v2Agg, v2.metrics, v2Grade);
    if (quiet) {
      v2Agg.quietNights++;
      v2Agg.quietFlat += v2Grade.flatReturn;
    }

    for (const λ of LAMBDAS) {
      const draft = runPortfolioFillExplicit(slots, v2Pool, "draft", {
        edgePackage: true,
        lambda: λ,
      });
      const g = gradeFill(draft, actuals);
      const agg = lambdaSweep.get(λ)!;
      addMetrics(agg, draft.metrics, g);
      if (quiet) {
        agg.quietNights++;
        agg.quietFlat += g.flatReturn;
      }
    }

    for (const ew of EDGE_WEIGHTS) {
      const pool = await loadFillPool(gameId, bands, null, {
        edgePackage: true,
        edgeWeights: { ...DEFAULT_EDGE_WEIGHTS, edgeWeight: ew },
      });
      const draft = runPortfolioFillExplicit(slots, pool, "draft", {
        edgePackage: true,
        lambda: 4,
      });
      const g = gradeFill(draft, actuals);
      const agg = edgeSweep.get(ew)!;
      addMetrics(agg, draft.metrics, g);
      if (quiet) {
        agg.quietNights++;
        agg.quietFlat += g.flatReturn;
      }
    }

    for (const lw of LEADER_WEIGHTS) {
      const pool = await loadFillPool(gameId, bands, null, {
        edgePackage: true,
        edgeWeights: { ...DEFAULT_EDGE_WEIGHTS, leadersWeight: lw },
      });
      const draft = runPortfolioFillExplicit(slots, pool, "draft", {
        edgePackage: true,
        lambda: 4,
      });
      const g = gradeFill(draft, actuals);
      const agg = leaderSweep.get(lw)!;
      addMetrics(agg, draft.metrics, g);
      if (quiet) {
        agg.quietNights++;
        agg.quietFlat += g.flatReturn;
      }
    }

    perGameRows.push(
      `| ${gameId} | ${game.home} v ${game.away} | ${live.metrics.effectiveIndependentBets.toFixed(2)} | ${v2.metrics.effectiveIndependentBets.toFixed(2)} | ${live.metrics.maxAppearances} | ${v2.metrics.maxAppearances} | ${liveGrade.slipHits}/${liveGrade.tickets} | ${v2Grade.slipHits}/${v2Grade.tickets} | ${quiet ? "yes" : ""} |`,
    );

    console.log(
      `  #${gameId} ${game.home} v ${game.away}: live maxApp=${live.metrics.maxAppearances} → v2 maxApp=${v2.metrics.maxAppearances} eff ${live.metrics.effectiveIndependentBets.toFixed(2)}→${v2.metrics.effectiveIndependentBets.toFixed(2)}${quiet ? " QUIET-STAR" : ""}`,
    );
  }

  if (liveAgg.games === 0) {
    throw new Error("No games graded");
  }

  const liveAvg = summarise(liveAgg);
  const v2Avg = summarise(v2Agg);

  const gateEff = v2Avg.effBets > liveAvg.effBets + 0.05;
  const gateMax = v2Avg.maxApp < liveAvg.maxApp - 0.05;
  const gateQuiet =
    v2Avg.quietNights === 0 ||
    v2Avg.quietFlat >= liveAvg.quietFlat - 0.01;
  const pass = gateEff && gateMax;

  // Recommend λ / edge / leaders from sweeps (diversification first)
  const λAvgs = LAMBDAS.map((λ) => ({ λ, ...summarise(lambdaSweep.get(λ)!) }));
  const edgeAvgs = EDGE_WEIGHTS.map((w) => ({
    w,
    ...summarise(edgeSweep.get(w)!),
  }));
  const leaderAvgs = LEADER_WEIGHTS.map((w) => ({
    w,
    ...summarise(leaderSweep.get(w)!),
  }));

  const bestLambda = λAvgs.reduce((a, b) =>
    a.maxApp < b.maxApp || (a.maxApp === b.maxApp && a.effBets >= b.effBets)
      ? a
      : b,
  );
  const bestEdge = edgeAvgs.reduce((a, b) =>
    a.flatRoi >= b.flatRoi ? a : b,
  );
  const bestLeaders = leaderAvgs.reduce((a, b) =>
    a.flatRoi >= b.flatRoi ? a : b,
  );

  const lines: string[] = [];
  lines.push(`# Portfolio edge package backtest — System book v2`);
  lines.push(``);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Season:** ${season} · **Games:** ${liveAvg.games}`);
  lines.push(
    `**Flag:** \`PORTFOLIO_EDGE_SCORE\` remains **OFF** — do not enable from this report.`,
  );
  lines.push(``);
  lines.push(`## What is compared`);
  lines.push(``);
  lines.push(
    `- **Live:** current draft fill (λ=4, hard wall 3, quadratic penalty, no satellite hard-cap, no edge/leaders).`,
  );
  lines.push(
    `- **v2 package:** satellite max-1 / core max-2 + odds edge + cushion + last-5 + last-game leaders (default weights).`,
  );
  lines.push(``);
  lines.push(`## Gate`);
  lines.push(``);
  lines.push(`| Check | Live draft | v2 package | Pass? |`);
  lines.push(`|-------|------------|------------|-------|`);
  lines.push(
    `| Effective independent bets ↑ | ${liveAvg.effBets.toFixed(2)} | ${v2Avg.effBets.toFixed(2)} | ${gateEff ? "YES" : "NO"} |`,
  );
  lines.push(
    `| Max appearances ↓ | ${liveAvg.maxApp.toFixed(2)} | ${v2Avg.maxApp.toFixed(2)} | ${gateMax ? "YES" : "NO"} |`,
  );
  lines.push(
    `| Quiet-star nights (flat $1) | ${liveAvg.quietFlat.toFixed(2)} (${liveAvg.quietNights}) | ${v2Avg.quietFlat.toFixed(2)} (${v2Avg.quietNights}) | ${gateQuiet ? "ok" : "watch"} |`,
  );
  lines.push(
    `| Slip hit | ${(liveAvg.slipHitPct * 100).toFixed(1)}% | ${(v2Avg.slipHitPct * 100).toFixed(1)}% | — |`,
  );
  lines.push(
    `| Flat ROI | ${(liveAvg.flatRoi * 100).toFixed(1)}% | ${(v2Avg.flatRoi * 100).toFixed(1)}% | — |`,
  );
  lines.push(``);
  lines.push(
    `**Overall gate: ${pass ? "PASS" : "FAIL"}** — ${pass ? "ready for maintainer to consider \`PORTFOLIO_EDGE_SCORE=on\`" : "retune weights before enabling"}.`,
  );
  lines.push(``);
  lines.push(`## λ sanity (v2 package)`);
  lines.push(``);
  lines.push(`| λ | Eff. bets | Max apps | Slip hit | Flat ROI | Quiet $ |`);
  lines.push(`|---|-----------|----------|----------|----------|---------|`);
  for (const d of λAvgs) {
    const mark = d.λ === bestLambda.λ ? " ← lowest max apps" : "";
    lines.push(
      `| ${d.λ}${mark} | ${d.effBets.toFixed(2)} | ${d.maxApp.toFixed(2)} | ${(d.slipHitPct * 100).toFixed(1)}% | ${(d.flatRoi * 100).toFixed(1)}% | ${d.quietFlat.toFixed(2)} |`,
    );
  }
  lines.push(``);
  lines.push(`## Edge weight sweep`);
  lines.push(``);
  lines.push(`| edgeWeight | Eff. bets | Max apps | Slip hit | Flat ROI |`);
  lines.push(`|------------|-----------|----------|----------|----------|`);
  for (const d of edgeAvgs) {
    const mark = d.w === bestEdge.w ? " ← best flat ROI" : "";
    lines.push(
      `| ${d.w}${mark} | ${d.effBets.toFixed(2)} | ${d.maxApp.toFixed(2)} | ${(d.slipHitPct * 100).toFixed(1)}% | ${(d.flatRoi * 100).toFixed(1)}% |`,
    );
  }
  lines.push(``);
  lines.push(`## Leaders weight sweep`);
  lines.push(``);
  lines.push(`| leadersWeight | Eff. bets | Max apps | Slip hit | Flat ROI |`);
  lines.push(`|---------------|-----------|----------|----------|----------|`);
  for (const d of leaderAvgs) {
    const mark = d.w === bestLeaders.w ? " ← best flat ROI" : "";
    lines.push(
      `| ${d.w}${mark} | ${d.effBets.toFixed(2)} | ${d.maxApp.toFixed(2)} | ${(d.slipHitPct * 100).toFixed(1)}% | ${(d.flatRoi * 100).toFixed(1)}% |`,
    );
  }
  lines.push(``);
  lines.push(`## Recommendation`);
  lines.push(``);
  lines.push(
    `- Default weights in code: edge=${DEFAULT_EDGE_WEIGHTS.edgeWeight}, cushion=${DEFAULT_EDGE_WEIGHTS.cushionWeight}, trend=${DEFAULT_EDGE_WEIGHTS.trendWeight}, leaders=${DEFAULT_EDGE_WEIGHTS.leadersWeight}.`,
  );
  lines.push(
    `- Sweep prefers λ=${bestLambda.λ}, edgeWeight=${bestEdge.w}, leadersWeight=${bestLeaders.w} on this sample.`,
  );
  lines.push(
    `- Wall stays **3** as circuit-breaker; satellite-1 does the real anti-clone work.`,
  );
  lines.push(
    `- **Stop here.** Maintainer reviews, then sets \`PORTFOLIO_EDGE_SCORE=on\` if satisfied. Do not flip from this script.`,
  );
  lines.push(``);
  lines.push(`## Per-game`);
  lines.push(``);
  lines.push(
    `| Game | Fixture | Live eff | v2 eff | Live max | v2 max | Live hits | v2 hits | Quiet |`,
  );
  lines.push(
    `|------|---------|----------|--------|----------|--------|-----------|---------|-------|`,
  );
  lines.push(...perGameRows);
  lines.push(``);
  lines.push(`## Notes`);
  lines.push(``);
  lines.push(
    `- Odds from \`odds_snapshots\` when present, else \`bookmaker_lines\`; missing prices degrade to non-edge scoring (cushion/trend/leaders still apply).`,
  );
  lines.push(
    `- Last-game leaders need \`player_game_stats\` for prior completed fixtures; empty → no HOT bonus.`,
  );
  lines.push(
    `- Flat ROI uses model-implied odds on $1 stakes (not bookie P&L).`,
  );
  lines.push(``);

  const outPath = join(process.cwd(), "docs", "portfolio-edge-backtest.md");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log(`Gate ${pass ? "PASS" : "FAIL"} · Do NOT enable PORTFOLIO_EDGE_SCORE from this script.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
