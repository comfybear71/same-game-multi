import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import { env } from "@/lib/env";
import * as schema from "./schema";

// Lazy, HTTP-based Drizzle client. neon-http is serverless-friendly (no
// persistent connection). The connection is created on first use rather than at
// import time so `next build` can evaluate modules without DATABASE_URL set.

export type Database = NeonHttpDatabase<typeof schema>;

let instance: Database | null = null;

function getDb(): Database {
  if (!instance) {
    const sql = neon(env.DATABASE_URL);
    instance = drizzle(sql, { schema });
  }
  return instance;
}

// Proxy forwards all access to the lazily-created client.
export const db = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
