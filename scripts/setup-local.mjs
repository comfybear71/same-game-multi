#!/usr/bin/env node
/**
 * Bootstrap or repair `.env.local` for local development.
 *
 * - Seeds from `.env.example` when keys are missing
 * - Preserves any values already present in `.env.local`
 * - Generates NEXTAUTH_SECRET when absent
 *
 * Usage: node scripts/setup-local.mjs
 * Or:    npm run setup:local
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const examplePath = resolve(root, ".env.example");
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

function serializeEnv(templateText, values) {
  const lines = templateText.split(/\r?\n/);
  const written = new Set();
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    if (values.has(key)) {
      out.push(`${key}=${values.get(key)}`);
      written.add(key);
    } else {
      out.push(line);
    }
  }

  // Append keys from .env.local that aren't in the template (e.g. VERCEL_OIDC_TOKEN).
  for (const [key, value] of values) {
    if (written.has(key)) continue;
    out.push(`${key}=${value}`);
  }

  return out.join("\n").replace(/\n?$/, "\n");
}

if (!existsSync(examplePath)) {
  console.error("Missing .env.example — cannot bootstrap .env.local.");
  process.exit(1);
}

const example = readFileSync(examplePath, "utf8");
const exampleVars = parseEnv(example);

/** @type {Map<string, string>} */
const merged = new Map(exampleVars);

if (existsSync(localPath)) {
  const existing = parseEnv(readFileSync(localPath, "utf8"));
  for (const [key, value] of existing) {
    if (value) merged.set(key, value);
  }
}

let generatedSecret = false;
if (!merged.get("NEXTAUTH_SECRET")?.trim()) {
  merged.set("NEXTAUTH_SECRET", randomBytes(32).toString("base64"));
  generatedSecret = true;
}

if (!merged.get("NEXTAUTH_URL")?.trim()) {
  merged.set("NEXTAUTH_URL", "http://localhost:3000");
}

writeFileSync(localPath, serializeEnv(example, merged), "utf8");

console.log("Wrote .env.local");
if (generatedSecret) {
  console.log("  ✓ Generated NEXTAUTH_SECRET");
}

const required = [
  { key: "DATABASE_URL", hint: "Neon pooled connection string" },
  { key: "ALLOWED_EMAILS", hint: "Comma-separated sign-in emails" },
];

const optional = [
  { key: "BLOB_READ_WRITE_TOKEN", hint: "Vercel Blob (bet screenshot uploads)" },
  { key: "ANTHROPIC_API_KEY", hint: "Claude vision for slip/lineup reads" },
];

console.log("\nRequired for auth + DB:");
for (const { key, hint } of required) {
  const ok = Boolean(merged.get(key)?.trim());
  console.log(`  ${ok ? "✓" : "✗"} ${key}${ok ? "" : ` — ${hint}`}`);
}

console.log("\nOptional (features work without these):");
for (const { key, hint } of optional) {
  const ok = Boolean(merged.get(key)?.trim());
  console.log(`  ${ok ? "✓" : "·"} ${key}${ok ? "" : ` — ${hint}`}`);
}

console.log(
  "\nIf env vars are already configured on Vercel, you can also run:\n" +
    "  vercel env pull .env.local\n" +
    "Then re-run: npm run setup:local  (keeps your secrets, fills gaps)\n"
);

const missingRequired = required.filter(({ key }) => !merged.get(key)?.trim());
if (missingRequired.length) {
  process.exitCode = 1;
}
