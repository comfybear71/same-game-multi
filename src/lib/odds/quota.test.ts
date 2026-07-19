/**
 * Run: npx tsx --test src/lib/odds/quota.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertQuotaFloor,
  parseQuotaHeaders,
  QuotaFloorError,
} from "@/lib/odds/quota";

describe("quota", () => {
  it("parses remaining/used headers", () => {
    const h = new Headers({
      "x-requests-remaining": "120",
      "x-requests-used": "880",
    });
    assert.deepEqual(parseQuotaHeaders(h), { remaining: 120, used: 880 });
  });

  it("aborts below floor", () => {
    assert.throws(
      () => assertQuotaFloor({ remaining: 49, used: 100 }, 50),
      (err: unknown) => err instanceof QuotaFloorError,
    );
  });

  it("allows remaining === floor", () => {
    assert.doesNotThrow(() =>
      assertQuotaFloor({ remaining: 50, used: 100 }, 50),
    );
  });

  it("skips check when remaining unknown", () => {
    assert.doesNotThrow(() =>
      assertQuotaFloor({ remaining: null, used: null }, 50),
    );
  });
});
