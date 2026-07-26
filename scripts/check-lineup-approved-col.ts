import "../src/db/loadDotenvLocal";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("No DATABASE_URL in .env.local");
    process.exit(1);
  }
  const sql = neon(url);
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'lineup_approved_at'
  `;
  console.log("lineup_approved_at on games:", cols.length > 0 ? "YES" : "NO");
  const mig = await sql`SELECT tag FROM app_migrations ORDER BY tag`;
  console.log(
    "Latest migrations:",
    mig.slice(-3).map((r) => r.tag).join(", "),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
