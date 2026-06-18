import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

// Apply pending Drizzle migrations from ./drizzle. Shared by the CLI runner
// (migrate.ts) and the runtime admin endpoint (/api/admin/migrate). Runs over
// Neon's HTTP driver, which is built for the serverless runtime — so triggering
// it from a deployed function is more reliable than connecting at build time.
export interface MigrateOutcome {
  applied: boolean; // false when skipped (no DATABASE_URL)
}

export async function runMigrations(): Promise<MigrateOutcome> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL is not set — skipping migrations.");
    return { applied: false };
  }
  const sql = neon(url);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { applied: true };
}
