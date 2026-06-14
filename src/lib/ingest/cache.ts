import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apiCache } from "@/db/schema";

// Postgres-backed response cache. External API responses (especially The Odds
// API, which is metered and paid) are cached here so repeated page loads and
// cron retries don't burn quota.

/** Read a cached payload if present and not expired. */
export async function getCached<T>(key: string): Promise<T | null> {
  const rows = await db
    .select()
    .from(apiCache)
    .where(eq(apiCache.key, key))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row.payload as T;
}

/** Write/replace a cached payload with a TTL in seconds. */
export async function setCached(
  key: string,
  payload: unknown,
  ttlSeconds: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db
    .insert(apiCache)
    .values({ key, payload: payload as object, expiresAt, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: apiCache.key,
      set: { payload: payload as object, expiresAt, fetchedAt: new Date() },
    });
}

/**
 * Fetch-through-cache helper. Returns cached value if fresh, otherwise calls
 * `fetcher`, stores the result, and returns it. If `fetcher` throws but a
 * (possibly stale) cached value exists, the stale value is returned so the UI
 * degrades gracefully instead of erroring.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const fresh = await getCached<T>(key);
  if (fresh !== null) return fresh;

  try {
    const value = await fetcher();
    await setCached(key, value, ttlSeconds);
    return value;
  } catch (err) {
    // Fall back to any stale cached payload before giving up.
    const stale = await db
      .select()
      .from(apiCache)
      .where(eq(apiCache.key, key))
      .limit(1);
    if (stale[0]) {
      console.warn(`[cache] using stale payload for ${key}:`, err);
      return stale[0].payload as T;
    }
    throw err;
  }
}
