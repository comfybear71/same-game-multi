/**
 * Dollar bankroll walk-forward sim CLI.
 *
 *   npx tsx scripts/bankroll-sim.ts
 *   npx tsx scripts/bankroll-sim.ts --source=5
 *
 * Uses graded Strategy lab slips; recomputes policy each round.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runBankrollSim } from "../src/lib/system/bankroll";

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const eqPrefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith(eqPrefix)) return a.slice(eqPrefix.length);
    if (a === `--${name}`) {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) return next;
    }
  }
  return undefined;
}

async function main() {
  const sourceRaw = arg("source");
  const sourceRunId = sourceRaw ? Number(sourceRaw) : undefined;
  console.log("Bankroll walk-forward sim");
  if (sourceRunId != null) console.log("  source run:", sourceRunId);

  const { runId } = await runBankrollSim({
    sourceRunId:
      sourceRunId != null && Number.isFinite(sourceRunId) ? sourceRunId : undefined,
  });

  const { getLatestBankrollSim } = await import("../src/lib/system/bankroll");
  const view = await getLatestBankrollSim();
  console.log("Done run #" + runId);
  if (view.run) {
    console.log(
      `  bank $${view.run.finalBank?.toFixed(2)} · capital in $${view.run.capitalInjected.toFixed(2)} · net $${view.run.netProfit?.toFixed(2)} · unit $${view.run.finalUnit?.toFixed(2)}`,
    );
    console.log(
      `  games ${view.run.gamesPlayed} · tickets ${view.run.ticketsHit}/${view.run.ticketsPlaced} hit`,
    );
    for (const c of view.checkpoints) {
      console.log(
        `  End ${c.season} (R${c.afterRound}): bank $${c.bank.toFixed(2)} net $${c.netProfit.toFixed(2)} unit $${c.unit.toFixed(2)}`,
      );
    }
    console.log("  Learned top:");
    for (const s of view.run.learnedTop) {
      console.log(`    ${s.rank}. ${s.label} (${s.tier})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
