import "dotenv/config";

import { runMigrations } from "./runMigrations";

// Standalone migration runner: `npm run db:migrate` (reads DATABASE_URL from
// .env.local). For deploys you can instead trigger /api/admin/migrate from the
// running app, which migrates over Neon's serverless driver.
runMigrations()
  .then((r) => {
    if (!r.applied) {
      console.log("No DATABASE_URL — nothing to do.");
    } else if (r.ran.length === 0) {
      console.log("Already up to date.");
    } else {
      console.log(`Applied ${r.ran.length} migration(s): ${r.ran.join(", ")}`);
    }
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
