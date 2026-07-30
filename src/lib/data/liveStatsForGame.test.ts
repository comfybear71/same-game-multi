/**
 * Run: npx tsx --test src/lib/data/liveStatsForGame.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchFeedToLineup, settlementStatValue, bestStatFromSources } from "@/lib/data/liveStatsForGame";

describe("matchFeedToLineup", () => {
  it("matches by normalised name and team", () => {
    const lineup = [
      {
        id: 1,
        playerName: "Nick Daicos",
        team: "Collingwood",
        jumper: 35,
        status: "named",
      },
    ];
    const feed = [
      {
        playerId: "CD_I1",
        playerName: "Nick Daicos",
        team: "Collingwood",
        goals: 1,
        kicks: 10,
        handballs: 8,
        disposals: 18,
        marks: 4,
        tackles: 0,
      },
    ];
    const map = matchFeedToLineup(lineup, feed);
    assert.equal(map.get(1)?.disposals, 18);
  });

  it("matches unique surname within team", () => {
    const lineup = [
      {
        id: 2,
        playerName: "Patrick Dangerfield",
        team: "Geelong",
        jumper: 35,
        status: "named",
      },
    ];
    const feed = [
      {
        playerId: "CD_I2",
        playerName: "P Dangerfield",
        team: "Geelong Cats",
        goals: 0,
        kicks: 5,
        handballs: 3,
        disposals: 8,
        marks: 1,
        tackles: 0,
      },
    ];
    const map = matchFeedToLineup(lineup, feed);
    assert.equal(map.get(2)?.disposals, 8);
  });
});

describe("settlementStatValue", () => {
  it("prefers Match Centre over AFL Tables", () => {
    assert.equal(settlementStatValue(28, 40), 28);
    assert.equal(settlementStatValue(35, 29), 35);
  });

  it("falls back to AFL Tables only when MC missing and not authoritative", () => {
    assert.equal(settlementStatValue(null, 5), 5);
    assert.equal(settlementStatValue(null, 5, { mcAuthoritative: true }), null);
  });

  it("bestStatFromSources alias prefers MC", () => {
    assert.equal(bestStatFromSources("disposals", 40, 28), 28);
    assert.equal(bestStatFromSources("tackles", 3, 6), 6);
  });
});
