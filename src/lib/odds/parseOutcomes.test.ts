/**
 * Run: npx tsx --test src/lib/odds/parseOutcomes.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseBookmakerProps } from "@/lib/odds/parseOutcomes";

describe("parseBookmakerProps", () => {
  it("pairs Over/Under by player + point", () => {
    const rows = parseBookmakerProps(
      [
        {
          key: "sportsbet",
          markets: [
            {
              key: "player_disposals",
              outcomes: [
                {
                  name: "Over",
                  description: "Nick Daicos",
                  price: 1.85,
                  point: 29.5,
                },
                {
                  name: "Under",
                  description: "Nick Daicos",
                  price: 1.95,
                  point: 29.5,
                },
              ],
            },
          ],
        },
      ],
      new Set(["player_disposals"]),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.playerName, "Nick Daicos");
    assert.equal(rows[0]!.statFamily, "disposals");
    assert.equal(rows[0]!.overOdds, 1.85);
    assert.equal(rows[0]!.underOdds, 1.95);
  });

  it("handles over-only (player as name)", () => {
    const rows = parseBookmakerProps(
      [
        {
          key: "tab",
          markets: [
            {
              key: "player_marks_over",
              outcomes: [
                { name: "James Sicily", price: 1.7, point: 6.5 },
              ],
            },
          ],
        },
      ],
      new Set(["player_marks_over"]),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.playerName, "James Sicily");
    assert.equal(rows[0]!.overOdds, 1.7);
    assert.equal(rows[0]!.underOdds, null);
  });
});
