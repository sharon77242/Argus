import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CrashGuard, type CrashEvent } from "../../src/profiling/crash-guard.ts";

describe("CrashGuard", () => {
  it("should intercept uncaught exceptions and emit suggestions", () => {
    process.env.NODE_ENV = "test";

    const guard = new CrashGuard((stack) => stack.toUpperCase()); // mock resolver
    const events: CrashEvent[] = [];
    guard.on("crash", (event: CrashEvent) => {
      events.push(event);
    });

    // Set active explicitly to avoid touching process.on
    (guard as any).active = true;

    // Trigger the private method directly to avoid breaking the Node test runner's
    // own uncaughtException listeners.
    const testError = new Error("test crash");
    (guard as any).handleCrash("uncaughtException", testError);

    assert.ok(events.length > 0);
    assert.strictEqual(events[0].type, "uncaughtException");
    assert.strictEqual(events[0].error, testError);
    assert.ok(events[0].suggestions![0]);
    assert.strictEqual(events[0].suggestions![0].severity, "critical");
    // Ensure the resolver was called
    assert.ok(events[0].resolvedStack!.includes("TEST CRASH"));
  });
});
