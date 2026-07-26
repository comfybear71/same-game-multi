/**
 * Run: npx tsx --test src/lib/ingest/lineupAudit.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditLineupRows, selectedCount } from "@/lib/ingest/lineupAudit";

describe("auditLineupRows", () => {
  it("warns when a team has too few selected players", () => {
    const rows = [
      ...Array.from({ length: 17 }, (_, i) => ({
        team: "Western Bulldogs",
        playerName: `Player ${i}`,
        jumper: i + 1,
        status: "named" as const,
      })),
      ...Array.from({ length: 23 }, (_, i) => ({
        team: "Richmond",
        playerName: `Tiger ${i}`,
        jumper: i + 1,
        status: "named" as const,
      })),
    ];
    const w = auditLineupRows(rows, "Western Bulldogs", "Richmond");
    assert.ok(w.some((x) => x.includes("Western Bulldogs") && x.includes("only 17")));
    assert.ok(w.some((x) => x.includes("Uneven squads")));
  });

  it("does not warn when the same jumper number is on both clubs", () => {
    const rows = [
      {
        team: "Western Bulldogs",
        playerName: "Josh Dolan",
        jumper: 26,
        status: "interchange" as const,
      },
      {
        team: "Richmond",
        playerName: "Jack Ross",
        jumper: 26,
        status: "interchange" as const,
      },
    ];
    const w = auditLineupRows(rows, "Western Bulldogs", "Richmond");
    assert.ok(!w.some((x) => x.includes("#26")));
  });
});

describe("selectedCount", () => {
  it("excludes emergencies", () => {
    const n = selectedCount(
      [
        { team: "A", playerName: "X", jumper: 1, status: "named" },
        { team: "A", playerName: "Y", jumper: 2, status: "emergency" },
      ],
      "A",
    );
    assert.equal(n, 1);
  });
});
