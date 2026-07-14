/**
 * Walk-forward SGM strategy backtest CLI.
 *
 * Usage:
 *   npx tsx scripts/backtest-sgm.ts
 *   npx tsx scripts/backtest-sgm.ts --seasons=2026 --max-games=3
 *   npx tsx scripts/backtest-sgm.ts --seasons=2024,2025,2026
 *   npx tsx scripts/backtest-sgm.ts --resume=1
 *
 * Requires DATABASE_URL (and SQUIGGLE_CONTACT) in .env.local.
 * Run migrations first: npm run db:migrate
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runBacktest } from "../src/lib/backtest/runner";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const seasonsRaw = arg("seasons") ?? "2024,2025,2026";
  const seasons = seasonsRaw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 2000);

  if (seasons.length === 0) {
    console.error("No valid seasons. Use --seasons=2024,2025,2026");
    process.exit(1);
  }

  const maxGames = arg("max-games") ? Number(arg("max-games")) : undefined;
  const resumeRunId = arg("resume") ? Number(arg("resume")) : undefined;
  const label = arg("label");

  console.log("Strategy lab backtest");
  console.log("  seasons:", seasons.join(", "));
  if (maxGames) console.log("  max-games:", maxGames);
  if (resumeRunId) console.log("  resume:", resumeRunId);
  if (flag("help")) {
    console.log(`
Options:
  --seasons=2024,2025,2026
  --max-games=N          smoke-test cap
  --resume=RUN_ID        continue a run
  --label=name
`);
    process.exit(0);
  }

  const result = await runBacktest({
    seasons,
    maxGames: Number.isFinite(maxGames) ? maxGames : undefined,
    resumeRunId: Number.isFinite(resumeRunId) ? resumeRunId : undefined,
    label,
    onProgress: (msg) => console.log(msg),
  });

  console.log("Result:", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
