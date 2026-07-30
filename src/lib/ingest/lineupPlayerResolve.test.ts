/**
 * Run: npx tsx --test src/lib/ingest/lineupPlayerResolve.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirror production rules — jumper alone must not cross surnames. */
function wouldMatch(
  lpName: string,
  lpJumper: number | null,
  pName: string,
  pJumper: number | null,
): boolean {
  const sn = (n: string) => n.trim().split(/\s+/).pop()!.toLowerCase();
  const nn = (n: string) => n.trim().toLowerCase();
  return (
    nn(lpName) === nn(pName) ||
    (sn(lpName) === sn(pName) &&
      (lpJumper == null || pJumper == null || pJumper === lpJumper)) ||
    (lpJumper != null &&
      pJumper === lpJumper &&
      sn(lpName) === sn(pName))
  );
}

describe("lineupPlayerResolve matching", () => {
  it("does not link debutant to veteran on same guernsey", () => {
    assert.equal(
      wouldMatch("Balyn O'Brien", 41, "Matthew Kennedy", 41),
      false,
    );
  });

  it("links same surname and jumper", () => {
    assert.equal(wouldMatch("Oscar Allen", 4, "Oscar Allen", 4), true);
  });
});
