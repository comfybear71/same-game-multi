/**
 * Run: npx tsx --test src/lib/system/edgeScore.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cushionSoftPoints,
  impliedProbability,
  last5TrendSoftPoints,
  lastGameLeaderSoftPoints,
  modelEdge,
} from "@/lib/system/edgeScore";

describe("impliedProbability / modelEdge", () => {
  it("3.10 → ~32.3% implied", () => {
    const implied = impliedProbability(3.1);
    assert.ok(Math.abs(implied - 1 / 3.1) < 1e-9);
    assert.ok(Math.abs(implied - 0.32258) < 0.001);
  });

  it("edge = model% − implied%", () => {
    const edge = modelEdge(0.45, 3.1);
    assert.ok(edge != null);
    assert.ok(Math.abs(edge! - (0.45 - 1 / 3.1)) < 1e-9);
  });

  it("null odds → null edge (graceful)", () => {
    assert.equal(modelEdge(0.6, null), null);
    assert.equal(modelEdge(0.6, 0), null);
  });
});

describe("cushionSoftPoints", () => {
  it("line below season avg scores higher than line above", () => {
    const easy = cushionSoftPoints(15, 20, 12);
    const hard = cushionSoftPoints(25, 20, 12);
    assert.ok(easy > hard);
    assert.ok(easy > 0);
    assert.ok(hard < 0);
  });

  it("missing season avg → 0", () => {
    assert.equal(cushionSoftPoints(20, null), 0);
  });
});

describe("last5TrendSoftPoints", () => {
  it("rising form is positive; falling is negative", () => {
    // most-recent-first
    const up = last5TrendSoftPoints([30, 28, 20, 18, 16], 6);
    const down = last5TrendSoftPoints([16, 18, 28, 30, 32], 6);
    assert.ok(up > 0);
    assert.ok(down < 0);
  });

  it("thin form → 0", () => {
    assert.equal(last5TrendSoftPoints([20, 21], 6), 0);
  });
});

describe("lastGameLeaderSoftPoints", () => {
  it("rank 1 > rank 2 > rank 3 > none", () => {
    const r1 = lastGameLeaderSoftPoints(1, 6);
    const r2 = lastGameLeaderSoftPoints(2, 6);
    const r3 = lastGameLeaderSoftPoints(3, 6);
    assert.ok(r1 > r2 && r2 > r3 && r3 > 0);
    assert.equal(lastGameLeaderSoftPoints(null, 6), 0);
    assert.equal(lastGameLeaderSoftPoints(4, 6), 0);
  });
});
