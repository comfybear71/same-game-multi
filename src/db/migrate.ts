import "dotenv/config";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

// Migration runner. Invoked two ways:
//   - `npm run db:migrate` standalone (reads DATABASE_URL from .env.local), and
//   - automatically before `next build` (see the build script) so a Vercel
//     deploy applies pending migrations with no manual step.
// A build without a database (local typecheck, CI, preview without secrets)
// skips rather than failing, preserving "next build works without secrets".
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL is not set — skipping migrations.");
    return;
  }

  const sql = neon(url);
  const db = drizzle(sql);

  console.log("Running migrations from ./drizzle ...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
