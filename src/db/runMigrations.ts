import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

// Self-healing migrator. Shared by the CLI runner (migrate.ts) and the runtime
// admin endpoint (/api/admin/migrate). Runs over Neon's HTTP driver.
//
// We deliberately don't use Drizzle's journal-replay migrate(): this database's
// schema is ahead of Drizzle's ledger (some columns were applied via db:push or
// by hand in Neon), so a strict replay keeps tripping on "column already exists"
// and never reaches the genuinely-new migration. Instead we track applied
// migrations in our own `app_migrations` table and apply each migration's SQL
// tolerating "already exists" errors — so a step that's already in the schema is
// simply marked done, and only truly-missing statements take effect.

const MIGRATIONS_DIR = "./drizzle";

interface JournalEntry {
  idx: number;
  tag: string;
}

export interface MigrateOutcome {
  applied: boolean; // false only when skipped (no DATABASE_URL)
  ran: string[]; // migration tags newly recorded this run
}

function readJournal(): JournalEntry[] {
  const path = join(MIGRATIONS_DIR, "meta", "_journal.json");
  if (!existsSync(path)) return [];
  const journal = JSON.parse(readFileSync(path, "utf8")) as {
    entries?: JournalEntry[];
  };
  return [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);
}

function isAlreadyExists(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? "";
  return msg.includes("already exists") || msg.includes("duplicate");
}

function statementsFor(tag: string): string[] {
  const file = join(MIGRATIONS_DIR, `${tag}.sql`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runMigrations(): Promise<MigrateOutcome> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL is not set — skipping migrations.");
    return { applied: false, ran: [] };
  }
  const db = drizzle(neon(url));

  // Our own ledger, independent of Drizzle's (which has drifted on this DB).
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS app_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    ),
  );
  const doneResult = await db.execute(sql.raw(`SELECT tag FROM app_migrations`));
  const done = new Set<string>(
    ((doneResult.rows ?? []) as { tag: string }[]).map((r) => r.tag),
  );

  const ran: string[] = [];
  for (const entry of readJournal()) {
    if (done.has(entry.tag)) continue;
    for (const statement of statementsFor(entry.tag)) {
      try {
        await db.execute(sql.raw(statement));
      } catch (err) {
        // A step already present in the schema (drift) is fine — skip it.
        if (!isAlreadyExists(err)) throw err;
      }
    }
    await db.execute(
      sql.raw(
        `INSERT INTO app_migrations (tag) VALUES ('${entry.tag}') ON CONFLICT DO NOTHING`,
      ),
    );
    ran.push(entry.tag);
  }
  return { applied: true, ran };
}
