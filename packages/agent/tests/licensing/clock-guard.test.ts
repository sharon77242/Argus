import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkClockIntegrity } from "../../src/licensing/clock-guard.ts";

describe("checkClockIntegrity", () => {
  test("first call is always ok", () => {
    const result = checkClockIntegrity("enterprise", Date.now());
    assert.equal(result, "ok");
  });

  test("within 60s tolerance returns ok for enterprise", () => {
    const result = checkClockIntegrity("enterprise", Date.now() - 30_000);
    assert.equal(result, "ok");
  });

  test("non-enterprise tier always returns ok regardless of clock skew", () => {
    // Simulate extreme clock rollback — should be ignored for non-enterprise
    assert.equal(checkClockIntegrity("self-hosted-pro", Date.now() - 300_000), "ok");
    assert.equal(checkClockIntegrity("individual", Date.now() - 300_000), "ok");
    assert.equal(checkClockIntegrity("pro", Date.now() - 300_000), "ok");
    assert.equal(checkClockIntegrity("team", Date.now() - 300_000), "ok");
  });

  test("enterprise tier returns rollback when clock is more than 60s behind", () => {
    // Pass a nowMs far in the past to simulate clock rollback
    // The monotonic clock will have advanced but the "wall clock" we pass is ancient
    const ancientNow = Date.now() - 120_000; // 2 minutes in the past
    const result = checkClockIntegrity("enterprise", ancientNow);
    assert.equal(result, "rollback");
  });

  test("enterprise tier returns ok when clock is within 60s tolerance", () => {
    const recentNow = Date.now() - 30_000; // 30 seconds in the past — within tolerance
    const result = checkClockIntegrity("enterprise", recentNow);
    assert.equal(result, "ok");
  });
});
