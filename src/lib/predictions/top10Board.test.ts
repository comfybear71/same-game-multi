/**
 * Run: npx tsx --test src/lib/predictions/top10Board.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lineTarget } from "@/lib/format";
import {
  buildTop10Reason,
  pickBoardLine,
  rankTop10Score,
} from "@/lib/predictions/top10Board";

describe("pickBoardLine", () => {
  const disposalsRungs = [14.5, 19.5, 24.5, 29.5, 34.5];

  it("picks near season avg, not highest clearable rung", () => {
    // ~20 avg mid — old chooseRung would pick 24.5 (25+) at prediction 26
    const line = pickBoardLine(disposalsRungs, 26, "disposals", 20);
    assert.ok(line != null);
    assert.equal(lineTarget(line!), 20); // 19.5 → 20+
    assert.notEqual(line, 24.5);
    assert.notEqual(line, 29.5);
  });

  it("never defaults to the top ladder rung", () => {
    const line = pickBoardLine(disposalsRungs, 36, "disposals", 28);
    assert.ok(line != null);
    assert.notEqual(line, 34.5);
  });

  it("Peatling-style 30+ on ~20 avg cannot be default", () => {
    const line = pickBoardLine(disposalsRungs, 22, "disposals", 20);
    assert.ok(line != null);
    assert.ok(lineTarget(line!) <= 21);
  });

  it("falls back to lowest clearable when projection is below avg line", () => {
    const line = pickBoardLine(disposalsRungs, 18, "disposals", 20);
    assert.ok(line != null);
    assert.equal(line, 14.5); // only clearable below 19.5
  });

  it("uses model rungs when bookie ladder empty", () => {
    const line = pickBoardLine([], 22, "disposals", 20);
    assert.ok(line != null);
    assert.ok(lineTarget(line!) >= 19);
    assert.ok(lineTarget(line!) <= 22);
  });

  it("caps goals line from season avg", () => {
    const goalRungs = [0.5, 1.5, 2.5, 3.5, 4.5];
    const line = pickBoardLine(goalRungs, 4, "goals", 2.1);
    assert.ok(line != null);
    assert.ok(lineTarget(line!) <= 3);
  });
});

describe("rankTop10Score", () => {
  it("ranks higher season avg above lower", () => {
    const high = rankTop10Score({
      seasonAvg: 28,
      prediction: 27,
      recentForm: [25, 26, 27],
      fantasyAvg: 90,
      benchmark: "elite",
    });
    const low = rankTop10Score({
      seasonAvg: 18,
      prediction: 19,
      recentForm: [17, 18, 19],
      fantasyAvg: 70,
      benchmark: "average",
    });
    assert.ok(high > low);
  });

  it("elite band beats below at similar avg", () => {
    const elite = rankTop10Score({
      seasonAvg: 25,
      prediction: 25,
      recentForm: [24, 25],
      fantasyAvg: 80,
      benchmark: "elite",
    });
    const below = rankTop10Score({
      seasonAvg: 25,
      prediction: 25,
      recentForm: [24, 25],
      fantasyAvg: 80,
      benchmark: "below",
    });
    assert.ok(elite > below);
  });
});

describe("buildTop10Reason", () => {
  it("includes band, avg, last game, and personal tape", () => {
    const reason = buildTop10Reason({
      benchmark: "elite",
      seasonAvg: 28.4,
      lastGame: 31,
      statType: "disposals",
      history: { hits: 3, bets: 4 },
    });
    assert.match(reason, /Elite/);
    assert.match(reason, /avg 28\.4/);
    assert.match(reason, /last 31/);
    assert.match(reason, /you 3\/4/);
  });
});
