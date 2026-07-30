/**
 * Run before bounce — no need to debug MC during the game.
 *
 *   npx tsx scripts/preflight-live-stats.ts 172
 */
import "../src/db/loadDotenvLocal";

async function main() {
  const gameId = Number(process.argv[2] ?? 172);
  const { preflightLiveStats } = await import("@/lib/data/liveStatsPreflight");
  const r = await preflightLiveStats(gameId);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ready ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
