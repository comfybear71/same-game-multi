/**
 * Smoke-check: Rich v Haw style book (exact leg counts from live screenshot).
 *   npx tsx scripts/check-fill-scenario.ts
 */
import {
  fillSnakeDraft,
  type FillCandidate,
  type TicketSlot,
} from "../src/lib/system/portfolioFill";

function cand(
  id: number,
  team: string,
  family: FillCandidate["statFamily"],
  score: number,
): FillCandidate {
  return {
    playerId: id,
    playerName: `P${id}`,
    team,
    statType: family,
    statFamily: family,
    line: 20,
    prediction: 22,
    confidence: score / 100,
    softScore: score,
  };
}

const teams = ["Hawthorn", "Richmond"];
const families: FillCandidate["statFamily"][] = [
  "goals",
  "marks",
  "disposals",
  "tackles",
  "kicks",
  "handballs",
];

const pool: FillCandidate[] = [];
let id = 1;
for (const fam of families) {
  for (let i = 0; i < 22; i++) {
    pool.push(cand(id, teams[i % 2]!, fam, 95 - i));
    id++;
  }
}

const slots: TicketSlot[] = [
  { id: "1", strategyKey: "goals_3", focus: "goals", legCount: 3 },
  { id: "2", strategyKey: "goals_6", focus: "goals", legCount: 6 },
  { id: "3", strategyKey: "marks_5", focus: "marks", legCount: 5 },
  { id: "4", strategyKey: "disposals_11", focus: "disposals", legCount: 11 },
  { id: "5", strategyKey: "disposals_6", focus: "disposals", legCount: 6 },
  { id: "6", strategyKey: "disposals_9", focus: "disposals", legCount: 9 },
  { id: "7", strategyKey: "tackles_8", focus: "tackles", legCount: 8 },
  { id: "8", strategyKey: "any_14", focus: "any", legCount: 14, isFun: true },
];

const result = fillSnakeDraft(slots, pool, { lambda: 4 });
let fail = 0;
for (const t of result.tickets) {
  const want = slots.find((s) => s.strategyKey === t.strategyKey)!.legCount;
  const ok = t.legs.length === want;
  if (!ok) fail++;
  console.log(
    `${ok ? "OK   " : "SHORT"} ${t.strategyKey.padEnd(14)} got ${String(t.legs.length).padStart(2)} / want ${want}`,
  );
}
console.log(
  `\nmetrics: eff=${result.metrics.effectiveIndependentBets} maxApp=${result.metrics.maxAppearances} lean=${result.metrics.bookLeanPct}% ${result.metrics.bookLeanClub ?? ""}`,
);
if (fail > 0) {
  console.error(`\n${fail} ticket(s) underfilled`);
  process.exit(1);
}
console.log("\nAll tickets filled to target.");
