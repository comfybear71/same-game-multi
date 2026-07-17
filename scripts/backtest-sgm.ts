/**
 * Walk-forward SGM strategy backtest CLI.
 *
 * Usage (prefer npx tsx so flags aren't eaten by npm on Windows):
 *   npx tsx scripts/backtest-sgm.ts --seasons=2026 --max-games=3
 *   npx tsx scripts/backtest-sgm.ts --seasons=2026 --label=strategy-lab-2026
 *   npx tsx scripts/backtest-sgm.ts --seasons='2024,2025,2026' --label=full-2024-2026
 *
 * Wide experiment (legs 3–25 × 5 focuses, player spread, $5 report):
 *   npx tsx scripts/backtest-sgm.ts --wide --spread --seasons='2024,2025,2026' --stake=5
 *   npx tsx scripts/backtest-sgm.ts --wide --spread --max-games=2 --stake=5
 *
 * Requires DATABASE_URL (and SQUIGGLE_CONTACT) in .env.local.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";

import { db } from "../src/db";
import { backtestSlips } from "../src/db/schema";
import { runBacktest } from "../src/lib/backtest/runner";
import {
  BACKTEST_STRATEGIES,
  buildStrategyMatrix,
  WIDE_EXPERIMENT_STRATEGIES,
} from "../src/lib/backtest/matrix";

/** Read --name=value, --name value, or bare name=value from argv. */
function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const eqPrefix = `--${name}=`;
  const barePrefix = `${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith(eqPrefix)) return a.slice(eqPrefix.length);
    if (a.startsWith(barePrefix)) return a.slice(barePrefix.length);
    if (a === `--${name}` || a === `-${name}`) {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) return next;
    }
  }
  return undefined;
}

function flag(name: string): boolean {
  return process.argv.slice(2).some((a) => a === `--${name}` || a === `-${name}`);
}

async function printStakeReport(runId: number, stake: number) {
  const rows = await db
    .select({
      strategyKey: backtestSlips.strategyKey,
      focus: backtestSlips.focus,
      legCount: backtestSlips.legCount,
      slips: sql<number>`count(*)::int`,
      hits: sql<number>`sum(case when ${backtestSlips.slipHit} then 1 else 0 end)::int`,
      flatReturned: sql<number>`sum(${backtestSlips.flatReturn})`,
    })
    .from(backtestSlips)
    .where(eq(backtestSlips.runId, runId))
    .groupBy(
      backtestSlips.strategyKey,
      backtestSlips.focus,
      backtestSlips.legCount,
    );

  const scored = rows
    .map((r) => {
      const slips = Number(r.slips);
      const hits = Number(r.hits);
      const flatReturned = Number(r.flatReturned);
      // flatReturn is $1-scale (estOdds on hit, else 0).
      const staked = slips * stake;
      const returned = flatReturned * stake;
      const pnl = returned - staked;
      const roi = staked > 0 ? pnl / staked : 0;
      return {
        key: r.strategyKey,
        focus: r.focus,
        legCount: r.legCount,
        slips,
        hits,
        hitPct: slips > 0 ? hits / slips : 0,
        staked,
        returned,
        pnl,
        roi,
      };
    })
    .sort((a, b) => b.roi - a.roi || b.pnl - a.pnl);

  const totalSlips = scored.reduce((s, r) => s + r.slips, 0);
  const totalHits = scored.reduce((s, r) => s + r.hits, 0);
  const totalStaked = scored.reduce((s, r) => s + r.staked, 0);
  const totalReturned = scored.reduce((s, r) => s + r.returned, 0);
  const totalPnl = totalReturned - totalStaked;

  console.log(`\n=== $${stake}/slip report (run #${runId}) ===`);
  console.log(
    `All slips: ${totalHits}/${totalSlips} hit · staked $${totalStaked.toFixed(0)} · returned $${totalReturned.toFixed(0)} · P&L $${totalPnl.toFixed(0)} (${totalStaked > 0 ? ((totalPnl / totalStaked) * 100).toFixed(1) : "0"}%)`,
  );
  console.log("\nTop 15 by ROI (min 20 slips):");
  const eligible = scored.filter((r) => r.slips >= 20);
  for (const r of eligible.slice(0, 15)) {
    console.log(
      `  ${r.key.padEnd(16)} hit ${(r.hitPct * 100).toFixed(1)}% (${r.hits}/${r.slips}) · P&L $${r.pnl.toFixed(0)} · ROI ${(r.roi * 100).toFixed(1)}%`,
    );
  }
  console.log("\nBy leg count (all focuses pooled):");
  const byLegs = new Map<number, { slips: number; hits: number; pnl: number; staked: number }>();
  for (const r of scored) {
    const cur = byLegs.get(r.legCount) ?? { slips: 0, hits: 0, pnl: 0, staked: 0 };
    cur.slips += r.slips;
    cur.hits += r.hits;
    cur.pnl += r.pnl;
    cur.staked += r.staked;
    byLegs.set(r.legCount, cur);
  }
  for (const leg of [...byLegs.keys()].sort((a, b) => a - b)) {
    const c = byLegs.get(leg)!;
    const roi = c.staked > 0 ? (c.pnl / c.staked) * 100 : 0;
    console.log(
      `  ${String(leg).padStart(2)} legs: hit ${((c.hits / c.slips) * 100).toFixed(1)}% (${c.hits}/${c.slips}) · P&L $${c.pnl.toFixed(0)} · ROI ${roi.toFixed(1)}%`,
    );
  }
}

async function main() {
  if (flag("help") || flag("h")) {
    console.log(`
Strategy lab backtest

Options:
  --seasons=2024,2025,2026
  --max-games=N          smoke-test cap
  --resume=RUN_ID        continue a run
  --label=name
  --wide                 legs 3–25 × 5 focuses (115 recipes)
  --legs=3-25            custom leg range (implies custom matrix)
  --spread               no repeat players across slips in a game
  --stake=5              print $N/slip P&L summary when done

Examples:
  npx tsx scripts/backtest-sgm.ts --seasons=2026 --max-games=3
  npx tsx scripts/backtest-sgm.ts --wide --spread --seasons='2024,2025,2026' --stake=5
`);
    process.exit(0);
  }

  const seasonsRaw = arg("seasons") ?? "2024,2025,2026";
  const seasons = seasonsRaw
    .split(/[\s,;]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 2000);

  if (seasons.length === 0) {
    console.error(
      "No valid seasons. Use --seasons=2024,2025,2026 (quote it in PowerShell: --seasons='2024,2025,2026')",
    );
    process.exit(1);
  }

  const maxGamesRaw = arg("max-games") ?? arg("maxGames");
  const maxGames = maxGamesRaw ? Number(maxGamesRaw) : undefined;
  const resumeRaw = arg("resume");
  const resumeRunId = resumeRaw ? Number(resumeRaw) : undefined;
  const stakeRaw = arg("stake");
  const stake = stakeRaw ? Number(stakeRaw) : undefined;
  const spreadPlayers = flag("spread");
  const wide = flag("wide");
  const legsRaw = arg("legs");

  let strategies = BACKTEST_STRATEGIES;
  if (wide) {
    strategies = WIDE_EXPERIMENT_STRATEGIES;
  } else if (legsRaw) {
    const m = legsRaw.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) {
      console.error("--legs must look like 3-25");
      process.exit(1);
    }
    strategies = buildStrategyMatrix({
      minLegs: Number(m[1]),
      maxLegs: Number(m[2]),
    });
  }

  const isExperiment = wide || !!legsRaw || spreadPlayers;
  const label =
    arg("label") ??
    (isExperiment
      ? `exp-${wide || legsRaw ? "wide" : "lab"}${spreadPlayers ? "-spread" : "-overlap"}-${seasons.join("-")}`
      : undefined);

  console.log("Strategy lab backtest");
  console.log("  argv:", process.argv.slice(2).join(" ") || "(none)");
  console.log("  seasons:", seasons.join(", "));
  console.log("  strategies:", strategies.length);
  console.log("  spread players:", spreadPlayers ? "yes" : "no");
  if (label) console.log("  label:", label);
  if (maxGames != null && Number.isFinite(maxGames)) {
    console.log("  max-games:", maxGames);
  }
  if (resumeRunId != null && Number.isFinite(resumeRunId)) {
    console.log("  resume:", resumeRunId);
  }
  if (stake != null && Number.isFinite(stake)) {
    console.log("  stake report: $", stake);
  }

  const result = await runBacktest({
    seasons,
    maxGames: maxGames != null && Number.isFinite(maxGames) ? maxGames : undefined,
    resumeRunId:
      resumeRunId != null && Number.isFinite(resumeRunId) ? resumeRunId : undefined,
    label,
    strategies,
    spreadPlayers,
    refreshPolicy: isExperiment ? false : undefined,
    onProgress: (msg) => console.log(msg),
  });

  console.log("Result:", result);

  if (stake != null && Number.isFinite(stake) && stake > 0) {
    await printStakeReport(result.runId, stake);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
