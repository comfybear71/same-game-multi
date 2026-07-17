/**
 * Dry-run System book for a fixture (no DB ticket writes).
 *
 *   npx tsx scripts/preview-system-book.ts
 *   npx tsx scripts/preview-system-book.ts --game=158
 *   npx tsx scripts/preview-system-book.ts --home=Collingwood --away=Carlton
 */
import "@/db/loadDotenvLocal";

import { getMatchupShortlist, type LeaderMetric } from "@/lib/data/leaders";
import { findGameByTeams, getGameById } from "@/lib/data/games";
import { currentSeason } from "@/lib/cron";
import { previewSystemPortfolio } from "@/lib/system/portfolio";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

function roi(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}

async function main() {
  const gameArg = arg("game");
  const homeArg = arg("home") ?? "Collingwood";
  const awayArg = arg("away") ?? "Carlton";

  let gameId = gameArg ? Number(gameArg) : null;
  if (gameId == null || Number.isNaN(gameId)) {
    gameId = await findGameByTeams(homeArg, awayArg);
  }
  if (gameId == null) {
    throw new Error(`No fixture found for ${homeArg} v ${awayArg}`);
  }

  const game = await getGameById(gameId);
  console.log(
    `\n=== System book PREVIEW (not persisted) ===\nGame #${gameId}: ${game?.home} v ${game?.away} · ${game?.status}\n`,
  );

  const preview = await previewSystemPortfolio(gameId);

  console.log("Playbook source:");
  if (preview.playbook) {
    console.log(
      `  ${preview.playbook.sourceLabel} (#${preview.playbook.sourceRunId}) · ${preview.playbook.meetings} meetings`,
    );
  } else {
    console.log("  (none — global helm only)");
  }

  console.log("\nSelected recipes:");
  for (const [i, r] of preview.recipes.entries()) {
    console.log(
      `  ${i + 1}. [${r.tier}] ${r.label} · H2H ${pct(r.h2hHitRate)} hit · ${roi(r.h2hRoi)} ROI (n=${r.h2hSlips})`,
    );
    console.log(`     ${r.why}`);
  }

  console.log("\nSuggested legs (preview only):");
  if (preview.tickets.length === 0) {
    console.log(
      "  (none — need lineup + predictions on this game for player legs)",
    );
  }
  for (const t of preview.tickets) {
    console.log(
      `\n  ${t.label} [${t.tier}] · model ${pct(t.modelledChance)} · est ${t.estOdds != null ? t.estOdds.toFixed(2) : "—"}`,
    );
    console.log(`  ${t.why}`);
    for (const l of t.legs) {
      const band = l.benchmark ? ` [${l.benchmark}]` : "";
      console.log(
        `    - ${l.playerName} (${l.team ?? "?"}) ${l.statType} ${l.line}+ · pred ${l.prediction.toFixed(1)} · conf ${pct(l.confidence)}${band}`,
      );
    }
  }

  // Bettable shortlists for core markets in this H2H (Elite→Average).
  const season = game?.season ?? currentSeason();
  const metrics: LeaderMetric[] = ["disposals", "marks", "tackles", "goals"];
  console.log("\n=== Player shortlists (Elite→Average) ===");
  for (const metric of metrics) {
    const rows = await getMatchupShortlist({
      season,
      metric,
      teamA: preview.home,
      teamB: preview.away,
      limit: 12,
    });
    console.log(`\n${metric}:`);
    if (rows.length === 0) {
      console.log("  (no averages yet)");
      continue;
    }
    for (const r of rows.slice(0, 10)) {
      console.log(
        `  ${r.rank}. [${r.band}] ${r.playerName} (${r.position}) ${r.team ?? "?"} · avg ${r.average}`,
      );
    }
  }

  console.log("\n(persisted: false — no system_tickets written)\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
