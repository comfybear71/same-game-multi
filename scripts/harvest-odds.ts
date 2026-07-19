/**
 * Harvest AFL player-prop odds from The Odds API into odds_snapshots.
 *
 *   npx tsx scripts/harvest-odds.ts
 *   npx tsx scripts/harvest-odds.ts --floor=50 --delay-ms=400
 *   npm run harvest:odds
 *
 * Requires ODDS_API_KEY + DATABASE_URL in .env.local.
 * Append-only snapshots — does not touch live trading / System book.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { QuotaFloorError } from "../src/lib/odds/quota";
import { runOddsHarvest } from "../src/lib/odds/runHarvest";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const apiKey = process.env.ODDS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ODDS_API_KEY missing — set it in .env.local");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing — set it in .env.local");
  }

  const report = await runOddsHarvest({
    apiKey,
    floor: Number(arg("floor") ?? process.env.ODDS_QUOTA_FLOOR ?? "50"),
    delayMs: Number(arg("delay-ms") ?? "350"),
    log: true,
  });

  if (report.abortedOnQuota) process.exit(2);
}

main().catch((err) => {
  if (err instanceof QuotaFloorError) {
    console.error(err.message);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});
