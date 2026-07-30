/**
 * Run: npx tsx --test src/lib/ingest/lineupPosition.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeLineupPosition,
  lineupPositionLabel,
} from "@/lib/ingest/lineupPosition";

describe("normalizeLineupPosition", () => {
  it("maps JPEG / Match Centre row headings to codes", () => {
    assert.equal(normalizeLineupPosition("Full Backs"), "FB");
    assert.equal(normalizeLineupPosition("Half Backs"), "HB");
    assert.equal(normalizeLineupPosition("Centres"), "C");
    assert.equal(normalizeLineupPosition("Half Forwards"), "HF");
    assert.equal(normalizeLineupPosition("Full Forwards"), "FF");
    assert.equal(normalizeLineupPosition("Followers"), "FOL");
  });

  it("accepts list-view abbreviations", () => {
    assert.equal(normalizeLineupPosition("FB"), "FB");
    assert.equal(normalizeLineupPosition("hb"), "HB");
    assert.equal(normalizeLineupPosition("FOL"), "FOL");
  });

  it("returns null for interchange and emergencies", () => {
    assert.equal(normalizeLineupPosition("Interchanges"), null);
    assert.equal(normalizeLineupPosition("Emergencies"), null);
  });
});

describe("lineupPositionLabel", () => {
  it("expands codes for display", () => {
    assert.equal(lineupPositionLabel("FB"), "Full Backs");
    assert.equal(lineupPositionLabel("HF"), "Half Forwards");
  });
});
