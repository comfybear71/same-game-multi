#!/usr/bin/env node
/**
 * Fail fast with a readable checklist before starting the dev server.
 *
 * Usage: node scripts/check-env.mjs
 * Or:    npm run check:env
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const localPath = resolve(root, ".env.local");

function parseEnv(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

if (!existsSync(localPath)) {
  console.error(
    "No .env.local found.\n\nRun:  npm run setup:local\nThen fill in DATABASE_URL and ALLOWED_EMAILS."
  );
  process.exit(1);
}

const env = parseEnv(readFileSync(localPath, "utf8"));

/** @type {{ key: string; label: string; hint: string }[]} */
const checks = [
  {
    key: "NEXTAUTH_SECRET",
    label: "NextAuth secret",
    hint: "Run npm run setup:local to generate one",
  },
  {
    key: "NEXTAUTH_URL",
    label: "NextAuth URL",
    hint: "Set to http://localhost:3000 for local dev",
  },
  {
    key: "DATABASE_URL",
    label: "Neon database",
    hint: "Copy the pooled connection string from Neon",
  },
  {
    key: "ALLOWED_EMAILS",
    label: "Sign-in allowlist",
    hint: "e.g. you@example.com,mate@example.com",
  },
];

const failures = checks.filter(({ key }) => !env.get(key)?.trim());

if (failures.length) {
  console.error("Environment not ready for local dev:\n");
  for (const { key, label, hint } of failures) {
    console.error(`  ✗ ${label} (${key}) — ${hint}`);
  }
  console.error("\nFix: edit .env.local, or run npm run setup:local");
  process.exit(1);
}

console.log("Environment OK for local dev (auth + database).");
