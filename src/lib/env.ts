import { z } from "zod";

// Centralised, validated environment access. Server-only — never import this
// from a client component.
//
// Validation is LAZY: it runs on first property access, not at import time, so
// `next build` (which may evaluate modules without a full env) doesn't crash.
// The first real request that touches a missing var still fails fast with a
// clear message.

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  NEXTAUTH_URL: z.string().url().optional(),
  ALLOWED_EMAILS: z.string().optional().default(""),
  BLOB_READ_WRITE_TOKEN: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  CRON_SECRET: z.string().optional().default(""),
  SQUIGGLE_CONTACT: z
    .string()
    .optional()
    .default("AFLMultiTracker/1.0 squiggle-contact-example.com"),
  // Comma-separated AFL news RSS feed URLs for injury/team-news context.
  // Empty = no news (the adapter falls back to a no-op, UI shows nothing).
  AFL_NEWS_FEEDS: z.string().optional().default("https://www.zerohanger.com/feed/"),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function resolve(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

// Proxy validates lazily on first property access.
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return resolve()[prop as keyof Env];
  },
});

/** Parsed allowlist of emails permitted to sign in (lower-cased). */
export function getAllowedEmails(): string[] {
  return env.ALLOWED_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAllowedEmails().includes(email.trim().toLowerCase());
}
