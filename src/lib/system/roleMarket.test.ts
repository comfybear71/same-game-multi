/**
 * Run: npx tsx --test src/lib/system/roleMarket.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { roleMarketSoftPoints } from "@/lib/system/roleMarket";

describe("roleMarketSoftPoints", () => {
  it("favours forwards on goals over full-backs", () => {
    assert.ok(
      roleMarketSoftPoints("FF", "goals") >
        roleMarketSoftPoints("FB", "goals"),
    );
    assert.ok(roleMarketSoftPoints("FB", "goals") < 0);
  });

  it("boosts backs for marks vs forwards", () => {
    assert.ok(
      roleMarketSoftPoints("HB", "marks") >
        roleMarketSoftPoints("FF", "marks"),
    );
  });
});
