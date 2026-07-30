/**
 * Run: npx tsx --test src/lib/ingest/aflMatchCentre.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAflPlayerStatRows } from "@/lib/ingest/aflMatchCentre";

describe("parseAflPlayerStatRows", () => {
  it("reads nested AFL playerStats and computes disposals from kicks+handballs", () => {
    const home = [
      {
        player: {
          player: {
            player: {
              playerId: "CD_I1012807",
              playerName: { givenName: "Sam", surname: "Berry" },
            },
          },
        },
        playerStats: {
          stats: {
            goals: 1,
            kicks: 10,
            handballs: 5,
            disposals: 0,
            marks: 3,
            tackles: 4,
          },
        },
      },
    ];
    const rows = parseAflPlayerStatRows(home, [], "Adelaide", "Collingwood");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].playerId, "CD_I1012807");
    assert.equal(rows[0].playerName, "Sam Berry");
    assert.equal(rows[0].disposals, 15);
    assert.equal(rows[0].goals, 1);
    assert.equal(rows[0].marks, 3);
    assert.equal(rows[0].tackles, 4);
  });
});
