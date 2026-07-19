/**
 * Run: npx tsx --test src/lib/odds/dedupe.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dedupeSnapshots, snapshotDedupeKey } from "@/lib/odds/dedupe";

describe("snapshot dedupe", () => {
  it("same event/player/market/line/bookmaker/price collapses", () => {
    const a = {
      oddsApiEventId: "e1",
      playerName: "Nick Daicos",
      marketKey: "player_disposals",
      line: 29.5,
      bookmaker: "sportsbet",
      overOdds: 1.85,
      underOdds: 1.95,
    };
    const b = { ...a };
    const c = { ...a, overOdds: 1.9 };
    const out = dedupeSnapshots([a, b, c]);
    assert.equal(out.length, 2);
    assert.equal(out[0], a);
    assert.equal(out[1], c);
  });

  it("key is case-insensitive on name/bookmaker", () => {
    assert.equal(
      snapshotDedupeKey({
        oddsApiEventId: "e",
        playerName: "Nick Daicos",
        marketKey: "m",
        line: 1,
        bookmaker: "Sportsbet",
        overOdds: 2,
        underOdds: null,
      }),
      snapshotDedupeKey({
        oddsApiEventId: "e",
        playerName: "nick daicos",
        marketKey: "m",
        line: 1,
        bookmaker: "sportsbet",
        overOdds: 2,
        underOdds: null,
      }),
    );
  });
});
