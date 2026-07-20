/**
 * Bookie prices for System book edge scoring.
 * PRIMARY: odds_snapshots (most recent snapshot per player+market+line).
 * FALLBACK: bookmaker_lines.
 */

import { and, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { bookmakerLines, oddsSnapshots } from "@/db/schema";
import type { StatType } from "@/db/schema";

export type PriceKey = `${number}:${StatType}:${number}`;

export function priceKey(
  playerId: number,
  statType: StatType,
  line: number,
): PriceKey {
  return `${playerId}:${statType}:${line}`;
}

/** Exact line match first; else closest line for that player×market. */
export function pickPrice(
  prices: Map<string, number>,
  playerId: number,
  statType: StatType,
  line: number,
): number | null {
  const exact = prices.get(priceKey(playerId, statType, line));
  if (exact != null && exact > 1) return exact;

  let best: { odds: number; dist: number } | null = null;
  const prefix = `${playerId}:${statType}:`;
  for (const [k, odds] of prices) {
    if (!k.startsWith(prefix) || odds <= 1) continue;
    const lined = Number(k.slice(prefix.length));
    if (!Number.isFinite(lined)) continue;
    const dist = Math.abs(lined - line);
    if (!best || dist < best.dist) best = { odds, dist };
  }
  return best?.odds ?? null;
}

/**
 * Most recent odds_snapshots overOdds per playerId+statFamily+line.
 * When multiple bookmakers share a snapshotAt, keep the first seen (any).
 */
export function selectLatestSnapshotPrices(
  rows: {
    playerId: number | null;
    statFamily: string | null;
    line: number;
    overOdds: number | null;
    snapshotAt: Date;
  }[],
): Map<string, number> {
  const best = new Map<
    string,
    { odds: number; at: number }
  >();

  for (const r of rows) {
    if (r.playerId == null || r.overOdds == null || r.overOdds <= 1) continue;
    if (
      r.statFamily !== "disposals" &&
      r.statFamily !== "marks" &&
      r.statFamily !== "tackles" &&
      r.statFamily !== "goals"
    ) {
      continue;
    }
    const k = priceKey(r.playerId, r.statFamily, r.line);
    const at = r.snapshotAt.getTime();
    const prev = best.get(k);
    if (!prev || at > prev.at) {
      best.set(k, { odds: r.overOdds, at });
    }
  }

  const out = new Map<string, number>();
  for (const [k, v] of best) out.set(k, v.odds);
  return out;
}

export async function loadOddsSnapshotPrices(
  gameId: number,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      playerId: oddsSnapshots.playerId,
      statFamily: oddsSnapshots.statFamily,
      line: oddsSnapshots.line,
      overOdds: oddsSnapshots.overOdds,
      snapshotAt: oddsSnapshots.snapshotAt,
    })
    .from(oddsSnapshots)
    .where(
      and(eq(oddsSnapshots.gameId, gameId), isNotNull(oddsSnapshots.playerId)),
    )
    .orderBy(desc(oddsSnapshots.snapshotAt));

  return selectLatestSnapshotPrices(rows);
}

export async function loadBookmakerLinePrices(
  gameId: number,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      playerId: bookmakerLines.playerId,
      statType: bookmakerLines.statType,
      line: bookmakerLines.line,
      overOdds: bookmakerLines.overOdds,
      fetchedAt: bookmakerLines.fetchedAt,
    })
    .from(bookmakerLines)
    .where(
      and(eq(bookmakerLines.gameId, gameId), isNotNull(bookmakerLines.playerId)),
    )
    .orderBy(desc(bookmakerLines.fetchedAt));

  const best = new Map<string, { odds: number; at: number }>();
  for (const r of rows) {
    if (r.playerId == null || r.overOdds == null || r.overOdds <= 1) continue;
    const k = priceKey(r.playerId, r.statType, r.line);
    const at = r.fetchedAt.getTime();
    const prev = best.get(k);
    if (!prev || at > prev.at) best.set(k, { odds: r.overOdds, at });
  }
  const out = new Map<string, number>();
  for (const [k, v] of best) out.set(k, v.odds);
  return out;
}

/**
 * Snapshots first; if empty for the fixture, fall back to bookmaker_lines.
 * Never throws — empty map = degrade to non-edge scoring.
 */
export async function loadBookPricesForGame(
  gameId: number,
): Promise<Map<string, number>> {
  try {
    const snaps = await loadOddsSnapshotPrices(gameId);
    if (snaps.size > 0) return snaps;
  } catch (err) {
    console.warn("[oddsPrices] snapshots failed:", err);
  }
  try {
    return await loadBookmakerLinePrices(gameId);
  } catch (err) {
    console.warn("[oddsPrices] bookmaker_lines failed:", err);
    return new Map();
  }
}
