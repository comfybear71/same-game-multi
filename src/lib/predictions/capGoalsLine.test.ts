/**
 * Run: npx tsx --test src/lib/predictions/capGoalsLine.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capGoalsLine } from "@/lib/predictions/suggest";

describe("capGoalsLine", () => {
  it("stops Stringer-class 4+ when season avg is ~2.1", () => {
    // 4+ display = line 3.5
    assert.equal(capGoalsLine(3.5, 2.1), 2.5); // 3+
    assert.equal(capGoalsLine(2.5, 2.1), 2.5);
    assert.equal(capGoalsLine(1.5, 2.1), 1.5);
  });

  it("missing avg does not cap", () => {
    assert.equal(capGoalsLine(3.5, null), 3.5);
  });
});
