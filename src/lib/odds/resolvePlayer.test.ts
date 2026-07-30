/**
 * Run: npx tsx --test src/lib/odds/resolvePlayer.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePlayerForFixture, resolvePlayerId } from "@/lib/odds/resolvePlayer";

const roster = [
  { id: 1, name: "Nick Daicos", team: "Collingwood" },
  { id: 2, name: "Josh Daicos", team: "Collingwood" },
  { id: 3, name: "Patrick Cripps", team: "Carlton" },
  { id: 4, name: "Sam Walsh", team: "Carlton" },
  { id: 5, name: "Jack Steele", team: "St Kilda" },
];

describe("resolvePlayerForFixture", () => {
  it("uses lineup guernsey when bookie name differs slightly", () => {
    const candidates = [
      { id: 10, name: "Finn O'Sullivan", team: "North Melbourne", jumper: 25 },
    ];
    const lineup: import("@/lib/odds/resolvePlayer").LineupHint[] = [
      {
        playerName: "Finn O'Sullivan",
        team: "North Melbourne",
        jumper: 25,
        playerId: null,
      },
    ];
    assert.equal(
      resolvePlayerForFixture(
        "F O'Sullivan",
        candidates,
        lineup,
        "North Melbourne",
        "St Kilda",
      ),
      10,
    );
  });
});

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

  it("does not map Levi Ashcroft to Will Ashcroft on Brisbane", () => {
    const bri = [
      { id: 1293, name: "Will Ashcroft", team: "Brisbane Lions", jumper: 8 },
      { id: 3301, name: "Levi Ashcroft", team: "Brisbane Lions", jumper: 10 },
    ];
    assert.equal(
      resolvePlayerId("Levi Ashcroft", bri, "Brisbane Lions"),
      3301,
    );
    assert.equal(
      resolvePlayerId("Will Ashcroft", bri, "Brisbane Lions"),
      1293,
    );
  });

  it("does not map Todd Marshall to sole Sam Marshall on another club", () => {
    const crossClub = [
      { id: 921, name: "Todd Marshall", team: "Port Adelaide", jumper: 4 },
      { id: 1421, name: "Sam Marshall", team: "Brisbane Lions", jumper: 20 },
      { id: 915, name: "Joe Berry", team: "Port Adelaide", jumper: 5 },
      { id: 1405, name: "Jarrod Berry", team: "Brisbane Lions", jumper: 7 },
    ];
    assert.equal(
      resolvePlayerId("Todd Marshall", crossClub, "Brisbane Lions"),
      null,
    );
    assert.equal(
      resolvePlayerId("Todd Marshall", crossClub, "Port Adelaide"),
      921,
    );
    assert.equal(resolvePlayerId("Joe Berry", crossClub, "Brisbane Lions"), null);
    assert.equal(
      resolvePlayerId("Joe Berry", crossClub, "Port Adelaide"),
      915,
    );
  });
});
