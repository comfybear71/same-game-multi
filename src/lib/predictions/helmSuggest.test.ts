import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { top10RowToSuggestedLeg } from "@/lib/predictions/helmSuggest";
import type { Top10Row } from "@/lib/predictions/top10Board";
import {
  pickBoardLine,
  rankTop10Score,
} from "@/lib/predictions/top10Board";

function row(partial: Partial<Top10Row> & Pick<Top10Row, "playerName" | "prediction" | "line">): Top10Row {
  return {
    rank: 1,
    playerId: 1,
    jumper: 7,
    team: "Collingwood",
    statType: "disposals",
    odds: 1.57,
    seasonAvg: 26.9,
    lastGame: 23,
    recentForm: [23, 28, 25],
    fantasyAvg: 100,
    benchmark: "elite",
    reason: "Elite · avg 26.9",
    availableRungs: [14.5, 19.5, 24.5, 29.5],
    history: { hits: 3, bets: 3 },
    news: null,
    ...partial,
  };
}

describe("helmSuggest top10RowToSuggestedLeg", () => {
  it("keeps board line and produces positive confidence for elite mid", () => {
    const leg = top10RowToSuggestedLeg(
      row({ playerName: "Josh Daicos", prediction: 27, line: 24.5 }),
    );
    assert.equal(leg.line, 24.5);
    assert.equal(leg.playerName, "Josh Daicos");
    assert.ok(leg.confidence > 0.4);
    assert.ok(leg.history?.hits === 3);
  });
});

describe("Top 10 ranks elite volume mids highly", () => {
  it("Josh-like mid outranks thin disposal name", () => {
    const josh = rankTop10Score({
      seasonAvg: 26.9,
      prediction: 27,
      recentForm: [23, 28, 25, 30, 22],
      fantasyAvg: 105,
      benchmark: "elite",
    });
    const fringe = rankTop10Score({
      seasonAvg: 14,
      prediction: 13,
      recentForm: [12, 15, 11],
      fantasyAvg: 55,
      benchmark: "average",
    });
    assert.ok(josh > fringe);
  });

  it("pickBoardLine stays near season avg not top rung", () => {
    const line = pickBoardLine(
      [14.5, 19.5, 24.5, 29.5],
      27,
      "disposals",
      26.9,
    );
    assert.equal(line, 24.5);
  });
});
