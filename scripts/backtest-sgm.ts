/**
 * Walk-forward SGM strategy backtest CLI.
 *
 * Usage (prefer npx tsx so flags aren't eaten by npm on Windows):
 *   npx tsx scripts/backtest-sgm.ts --seasons=2026 --max-games=3
 *   npx tsx scripts/backtest-sgm.ts --seasons=2026 --label=strategy-lab-2026
 *   npx tsx scripts/backtest-sgm.ts --seasons=2024,2025,2026
 *   npx tsx scripts/backtest-sgm.ts --resume=2
 *
 * PowerShell: quote multi-season lists (commas are array syntax):
 *   npx tsx scripts/backtest-sgm.ts --seasons='2024,2025,2026' --label=full-2024-2026
 *
 * Or: npm run backtest -- --seasons=2026 --max-games=3
 *
 * Weekly Vercel cron resumes label strategy-lab-{year}. Bootstrap once locally
 * (or let Monday create it); cron then only grades newly completed games.
 *
 * Requires DATABASE_URL (and SQUIGGLE_CONTACT) in .env.local.
 * Run migrations first: npm run db:migrate
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runBacktest } from "../src/lib/backtest/runner";

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

async function main() {
  if (flag("help") || flag("h")) {
    console.log(`
Strategy lab backtest

Options:
  --seasons=2024,2025,2026
  --max-games=N          smoke-test cap
  --resume=RUN_ID        continue a run
  --label=name

Examples:
  npx tsx scripts/backtest-sgm.ts --seasons=2026 --max-games=3
  npx tsx scripts/backtest-sgm.ts --seasons=2024,2025,2026
`);
    process.exit(0);
  }

  // PowerShell treats commas as array separators, so
  // --seasons=2024,2025,2026 often arrives as "2024 2025 2026".
  // Prefer quotes on Windows: --seasons='2024,2025,2026'
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
  const label = arg("label");

  console.log("Strategy lab backtest");
  console.log("  argv:", process.argv.slice(2).join(" ") || "(none)");
  console.log("  seasons:", seasons.join(", "));
  if (maxGames != null && Number.isFinite(maxGames)) {
    console.log("  max-games:", maxGames);
  }
  if (resumeRunId != null && Number.isFinite(resumeRunId)) {
    console.log("  resume:", resumeRunId);
  }

  const result = await runBacktest({
    seasons,
    maxGames: maxGames != null && Number.isFinite(maxGames) ? maxGames : undefined,
    resumeRunId:
      resumeRunId != null && Number.isFinite(resumeRunId) ? resumeRunId : undefined,
    label,
    onProgress: (msg) => console.log(msg),
  });

  console.log("Result:", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
