/**
 * Manual live-stats sync (same logic as cron). Requires DATABASE_URL + network.
 *
 *   npx tsx scripts/sync-live-stats.ts
 */
import "../src/db/loadDotenvLocal";

async function main() {
  const { syncLivePlayerStats } = await import("@/lib/ingest/liveStatsSync");
  const result = await syncLivePlayerStats();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
