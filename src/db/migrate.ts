import "dotenv/config";

import { runMigrations } from "./runMigrations";

// Standalone migration runner: `npm run db:migrate` (reads DATABASE_URL from
// .env.local). For deploys you can instead trigger /api/admin/migrate from the
// running app, which migrates over Neon's serverless driver.
runMigrations()
  .then((r) => {
    console.log(r.applied ? "Migrations complete." : "No DATABASE_URL — nothing to do.");
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
