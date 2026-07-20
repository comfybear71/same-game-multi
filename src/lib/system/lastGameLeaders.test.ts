/**
 * Run: npx tsx --test src/lib/system/lastGameLeaders.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  leadersByKey,
  rankLastGameLeaders,
  type PrevGameStatRow,
} from "@/lib/system/lastGameLeaders";

describe("rankLastGameLeaders", () => {
  const rows: PrevGameStatRow[] = [
    {
      playerId: 1,
      team: "Richmond",
      disposals: 35,
      marks: 4,
      tackles: 2,
      goals: 0,
    },
    {
      playerId: 2,
      team: "Richmond",
      disposals: 28,
      marks: 8,
      tackles: 1,
      goals: 5,
    },
    {
      playerId: 3,
      team: "Hawthorn",
      disposals: 30,
      marks: 10,
      tackles: 6,
      goals: 1,
    },
    {
      playerId: 4,
      team: "Hawthorn",
      disposals: 22,
      marks: 3,
      tackles: 9,
      goals: 3,
    },
    {
      playerId: 5,
      team: "Hawthorn",
      disposals: 18,
      marks: 2,
      tackles: 4,
      goals: 0,
    },
  ];

  it("top 3 disposals across both clubs", () => {
    const leaders = rankLastGameLeaders(rows);
    const disp = leaders
      .filter((l) => l.statType === "disposals")
      .sort((a, b) => a.rank - b.rank);
    assert.equal(disp.length, 3);
    assert.equal(disp[0]!.playerId, 1);
    assert.equal(disp[0]!.lastValue, 35);
    assert.equal(disp[1]!.playerId, 3);
    assert.equal(disp[2]!.playerId, 2);
  });

  it("goals leader boosts goals category only (lookup key)", () => {
    const map = leadersByKey(rankLastGameLeaders(rows));
    assert.ok(map.get("2:goals"));
    assert.equal(map.get("2:goals")!.rank, 1);
    assert.equal(map.get("2:goals")!.lastValue, 5);
    // Same player can also rank in disposals — separate key, not auto-copied
    assert.equal(map.get("2:disposals")?.rank, 3);
    // Goals #1 with only 1 tackle is not a tackles leader
    assert.equal(map.has("2:tackles"), false);
  });

  it("empty rows → empty leaders (no previous game)", () => {
    assert.deepEqual(rankLastGameLeaders([]), []);
  });
});
