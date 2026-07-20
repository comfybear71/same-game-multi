/**
 * Run: npx tsx --test src/lib/system/oddsPrices.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  pickPrice,
  priceKey,
  selectLatestSnapshotPrices,
} from "@/lib/system/oddsPrices";

describe("selectLatestSnapshotPrices", () => {
  it("keeps most recent snapshot per player+market+line", () => {
    const map = selectLatestSnapshotPrices([
      {
        playerId: 1,
        statFamily: "disposals",
        line: 24.5,
        overOdds: 1.8,
        snapshotAt: new Date("2026-07-01T10:00:00Z"),
      },
      {
        playerId: 1,
        statFamily: "disposals",
        line: 24.5,
        overOdds: 1.95,
        snapshotAt: new Date("2026-07-02T10:00:00Z"),
      },
      {
        playerId: 1,
        statFamily: "goals",
        line: 1.5,
        overOdds: 2.4,
        snapshotAt: new Date("2026-07-02T10:00:00Z"),
      },
    ]);
    assert.equal(map.get(priceKey(1, "disposals", 24.5)), 1.95);
    assert.equal(map.get(priceKey(1, "goals", 1.5)), 2.4);
  });

  it("skips unmapped / fantasy families and null players", () => {
    const map = selectLatestSnapshotPrices([
      {
        playerId: null,
        statFamily: "disposals",
        line: 20,
        overOdds: 2,
        snapshotAt: new Date(),
      },
      {
        playerId: 2,
        statFamily: "fantasy",
        line: 100,
        overOdds: 1.9,
        snapshotAt: new Date(),
      },
    ]);
    assert.equal(map.size, 0);
  });
});

describe("pickPrice", () => {
  it("exact line, else closest", () => {
    const prices = new Map<string, number>([
      [priceKey(1, "disposals", 19.5), 1.7],
      [priceKey(1, "disposals", 24.5), 2.1],
    ]);
    assert.equal(pickPrice(prices, 1, "disposals", 24.5), 2.1);
    assert.equal(pickPrice(prices, 1, "disposals", 25), 2.1);
    assert.equal(pickPrice(prices, 1, "marks", 5), null);
  });
});
