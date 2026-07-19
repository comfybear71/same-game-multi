/**
 * Run: npx tsx --test src/lib/odds/resolvePlayer.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePlayerId } from "@/lib/odds/resolvePlayer";

const roster = [
  { id: 1, name: "Nick Daicos", team: "Collingwood" },
  { id: 2, name: "Josh Daicos", team: "Collingwood" },
  { id: 3, name: "Patrick Cripps", team: "Carlton" },
  { id: 4, name: "Sam Walsh", team: "Carlton" },
  { id: 5, name: "Jack Steele", team: "St Kilda" },
];

describe("resolvePlayerId", () => {
  it("matches full name", () => {
    assert.equal(
      resolvePlayerId("Nick Daicos", roster, "Collingwood"),
      1,
    );
  });

  it("matches nickname → formal (Sam → Samuel style via map)", () => {
    // Samuel not in roster; Sam Walsh is — exact short form
    assert.equal(resolvePlayerId("Sam Walsh", roster, "Carlton"), 4);
  });

  it("matches Nicholas → Nick via nickname map", () => {
    assert.equal(
      resolvePlayerId("Nicholas Daicos", roster, "Collingwood"),
      1,
    );
  });

  it("club + unique surname", () => {
    assert.equal(resolvePlayerId("Cripps", roster, "Carlton"), 3);
  });

  it("ambiguous surname without initial → null (never wrong merge)", () => {
    assert.equal(resolvePlayerId("Daicos", roster, "Collingwood"), null);
  });

  it("surname + initial disambiguates", () => {
    assert.equal(resolvePlayerId("N Daicos", roster, "Collingwood"), 1);
    assert.equal(resolvePlayerId("J. Daicos", roster, "Collingwood"), 2);
  });

  it("wrong club does not steal unique other-club surname", () => {
    assert.equal(resolvePlayerId("Steele", roster, "Carlton"), null);
  });

  it("Jackson Steele ↔ Jack Steele via nickname", () => {
    assert.equal(
      resolvePlayerId("Jackson Steele", roster, "St Kilda"),
      5,
    );
  });
});
