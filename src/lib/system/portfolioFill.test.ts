/**
 * Run: npx tsx --test src/lib/system/portfolioFill.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assembleSoftScore,
  avgPairwiseOverlap,
  computeMetrics,
  exposureKey,
  fillGreedy,
  fillSnakeDraft,
  resolveStatFamily,
  shrunkRate,
  tapeModifier,
  type FillCandidate,
  type TicketSlot,
} from "@/lib/system/portfolioFill";

describe("shrunkRate", () => {
  it("pins 0/2 → ~54%, 6/7 → ~74%, 0/1 → ~59%", () => {
    assert.ok(Math.abs(shrunkRate(0, 2) - 0.5417) < 0.01);
    assert.ok(Math.abs(shrunkRate(6, 7) - 0.735) < 0.02);
    assert.ok(Math.abs(shrunkRate(0, 1) - 0.5909) < 0.01);
  });
});

describe("resolveStatFamily / exposure", () => {
  it("maps any to dominant family", () => {
    assert.equal(resolveStatFamily("any", "disposals"), "disposals");
    assert.equal(resolveStatFamily("goals"), "goals");
    assert.equal(exposureKey(7, "disposals"), "7:disposals");
  });
});

describe("tapeModifier", () => {
  it("clamps to ±10", () => {
    assert.equal(tapeModifier(0.95), 10);
    assert.equal(tapeModifier(0.35), -10);
    assert.ok(Math.abs(tapeModifier(0.65)) < 0.01);
  });
});

function cand(
  partial: Partial<FillCandidate> &
    Pick<FillCandidate, "playerId" | "playerName" | "team" | "statFamily">,
): FillCandidate {
  return {
    statType: partial.statFamily as FillCandidate["statType"],
    line: 20,
    prediction: 22,
    confidence: 0.7,
    softScore: 70,
    ...partial,
  };
}

describe("snake draft vs greedy", () => {
  const pool: FillCandidate[] = [
    cand({
      playerId: 1,
      playerName: "Nick",
      team: "Collingwood",
      statFamily: "disposals",
      softScore: 95,
      confidence: 0.85,
      historyHits: 6,
      historyBets: 7,
    }),
    cand({
      playerId: 2,
      playerName: "Cripps",
      team: "Carlton",
      statFamily: "disposals",
      softScore: 90,
      confidence: 0.8,
      historyHits: 2,
      historyBets: 3,
    }),
    cand({
      playerId: 3,
      playerName: "Newman",
      team: "Carlton",
      statFamily: "disposals",
      softScore: 88,
      confidence: 0.78,
    }),
    cand({
      playerId: 4,
      playerName: "Walsh",
      team: "Carlton",
      statFamily: "disposals",
      softScore: 87,
      confidence: 0.74,
    }),
    cand({
      playerId: 5,
      playerName: "Josh",
      team: "Collingwood",
      statFamily: "disposals",
      softScore: 84,
      confidence: 0.72,
      historyHits: 3,
      historyBets: 3,
    }),
    cand({
      playerId: 6,
      playerName: "Pendles",
      team: "Collingwood",
      statFamily: "disposals",
      softScore: 82,
      confidence: 0.7,
    }),
    cand({
      playerId: 7,
      playerName: "Houston",
      team: "Collingwood",
      statFamily: "disposals",
      softScore: 80,
      confidence: 0.68,
    }),
    cand({
      playerId: 8,
      playerName: "Acres",
      team: "Carlton",
      statFamily: "disposals",
      softScore: 79,
      confidence: 0.67,
      historyHits: 2,
      historyBets: 2,
    }),
    cand({
      playerId: 9,
      playerName: "Crisp",
      team: "Collingwood",
      statFamily: "disposals",
      softScore: 77,
      confidence: 0.66,
    }),
    cand({
      playerId: 10,
      playerName: "Cerra",
      team: "Carlton",
      statFamily: "disposals",
      softScore: 76,
      confidence: 0.65,
    }),
  ];

  const slots: TicketSlot[] = [
    { id: "a", strategyKey: "disposals:3", focus: "disposals", legCount: 3 },
    { id: "b", strategyKey: "disposals:4", focus: "disposals", legCount: 4 },
    { id: "c", strategyKey: "disposals:5", focus: "disposals", legCount: 5 },
    {
      id: "fun",
      strategyKey: "any:fun",
      focus: "any",
      legCount: 10,
      isFun: true,
    },
  ];

  it("hard wall at 3 appearances", () => {
    const draft = fillSnakeDraft(slots, pool, { lambda: 8, hardWall: 3 });
    const counts = new Map<string, number>();
    for (const t of draft.tickets.filter((x) => !x.isFun)) {
      for (const l of t.legs) {
        const k = exposureKey(l.playerId, l.statFamily);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    for (const n of counts.values()) assert.ok(n <= 3);
    assert.ok(draft.metrics.maxAppearances <= 3);
  });

  it("draft reduces max appearances vs greedy", () => {
    const greedy = fillGreedy(slots, pool);
    const draft = fillSnakeDraft(slots, pool, { lambda: 12 });
    assert.ok(
      draft.metrics.maxAppearances <= greedy.metrics.maxAppearances,
      `draft max ${draft.metrics.maxAppearances} vs greedy ${greedy.metrics.maxAppearances}`,
    );
    assert.ok(
      draft.metrics.effectiveIndependentBets >=
        greedy.metrics.effectiveIndependentBets - 0.01,
    );
  });

  it("FUN excludes cores", () => {
    const draft = fillSnakeDraft(slots, pool);
    const fun = draft.tickets.find((t) => t.isFun);
    assert.ok(fun);
    for (const core of draft.cores) {
      const hit = fun!.legs.some(
        (l) =>
          l.playerId === core.playerId && l.statFamily === core.family,
      );
      assert.equal(hit, false, `FUN reused core ${core.playerName}`);
    }
  });

  it("cores are distinct markets", () => {
    const pool2 = [
      ...pool,
      cand({
        playerId: 1,
        playerName: "Nick Goals",
        team: "Collingwood",
        statFamily: "goals",
        softScore: 94,
        confidence: 0.7,
        historyHits: 6,
        historyBets: 7,
      }),
    ];
    const draft = fillSnakeDraft(slots, pool2);
    const families = draft.cores.map((c) => c.family);
    assert.equal(new Set(families).size, families.length);
  });

  it("fills odd leg counts under 50% team cap (not stuck at 2/3)", () => {
    const goalsPool: FillCandidate[] = [
      cand({
        playerId: 101,
        playerName: "Gunston",
        team: "Hawthorn",
        statFamily: "goals",
        softScore: 90,
        confidence: 0.6,
      }),
      cand({
        playerId: 102,
        playerName: "Taranto",
        team: "Richmond",
        statFamily: "goals",
        softScore: 88,
        confidence: 0.58,
      }),
      cand({
        playerId: 103,
        playerName: "Ginnivan",
        team: "Hawthorn",
        statFamily: "goals",
        softScore: 86,
        confidence: 0.57,
      }),
      cand({
        playerId: 104,
        playerName: "Balta",
        team: "Richmond",
        statFamily: "goals",
        softScore: 84,
        confidence: 0.55,
      }),
      cand({
        playerId: 105,
        playerName: "Breust",
        team: "Hawthorn",
        statFamily: "goals",
        softScore: 82,
        confidence: 0.54,
      }),
      cand({
        playerId: 106,
        playerName: "Rioli",
        team: "Richmond",
        statFamily: "goals",
        softScore: 80,
        confidence: 0.53,
      }),
    ];
    const goalSlots: TicketSlot[] = [
      {
        id: "g3",
        strategyKey: "goals_3",
        focus: "goals",
        legCount: 3,
      },
      {
        id: "g6",
        strategyKey: "goals_6",
        focus: "goals",
        legCount: 6,
      },
    ];
    const draft = fillSnakeDraft(goalSlots, goalsPool, { lambda: 4 });
    const g3 = draft.tickets.find((t) => t.strategyKey === "goals_3");
    const g6 = draft.tickets.find((t) => t.strategyKey === "goals_6");
    assert.equal(g3?.legs.length, 3, `goals_3 got ${g3?.legs.length}`);
    assert.equal(g6?.legs.length, 6, `goals_6 got ${g6?.legs.length}`);
  });
});

describe("metrics", () => {
  it("effective bets maths", () => {
    const tickets = [
      {
        slotId: "a",
        strategyKey: "a",
        isFun: false,
        legs: [
          cand({
            playerId: 1,
            playerName: "A",
            team: "X",
            statFamily: "disposals",
          }),
          cand({
            playerId: 2,
            playerName: "B",
            team: "Y",
            statFamily: "disposals",
          }),
        ],
      },
      {
        slotId: "b",
        strategyKey: "b",
        isFun: false,
        legs: [
          cand({
            playerId: 1,
            playerName: "A",
            team: "X",
            statFamily: "disposals",
          }),
          cand({
            playerId: 3,
            playerName: "C",
            team: "Y",
            statFamily: "disposals",
          }),
        ],
      },
    ];
    const overlap = avgPairwiseOverlap(tickets);
    // Jaccard: intersection 1, union 3 → 1/3
    assert.ok(Math.abs(overlap - 1 / 3) < 0.01);
    const m = computeMetrics(tickets);
    assert.ok(Math.abs(m.effectiveIndependentBets - 2 * (1 - 1 / 3)) < 0.05);
  });
});

describe("assembleSoftScore", () => {
  it("applies bounded tape", () => {
    const base = assembleSoftScore({ confidence: 0.7 });
    const boosted = assembleSoftScore({
      confidence: 0.7,
      historyHits: 6,
      historyBets: 7,
    });
    assert.ok(boosted > base);
    assert.ok(boosted - base <= 10);
  });
});
