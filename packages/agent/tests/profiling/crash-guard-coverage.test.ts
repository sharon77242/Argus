/**
 * Additional coverage tests for CrashGuard
 * Targets: unhandledRejection (lines 39-41), disable idempotency (line 29),
 *          handleCrash when NOT active (line 46), and process.exit path (lines 69-70)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CrashGuard, type CrashEvent } from "../../src/profiling/crash-guard.ts";

describe("CrashGuard (coverage)", () => {
  it("should handle unhandledRejection with an Error object", async () => {
    process.env.NODE_ENV = "test";
    const guard = new CrashGuard();
    const events: CrashEvent[] = [];
    guard.on("crash", (e: CrashEvent) => {
      events.push(e);
    });

    (guard as any).active = true;

    const testError = new Error("Promise blew up");
    (guard as any).handleUnhandledRejection(testError);

    assert.ok(events.length > 0, "Should have emitted crash event");
    assert.strictEqual(events[0].type, "unhandledRejection");
    assert.strictEqual(events[0].error, testError);
    assert.ok(events[0].suggestions![0].message.includes("async Promise"));
  });

  it("should handle unhandledRejection with a non-Error reason", async () => {
    process.env.NODE_ENV = "test";
    const guard = new CrashGuard();
    const events: CrashEvent[] = [];
    guard.on("crash", (e: CrashEvent) => {
      events.push(e);
    });

    (guard as any).active = true;

    (guard as any).handleUnhandledRejection("string rejection reason");

    assert.ok(events.length > 0, "Should have emitted crash event");
    assert.strictEqual(events[0].type, "unhandledRejection");
    assert.ok(events[0].error instanceof Error, "Should wrap string in Error");
    assert.ok(events[0].error.message.includes("string rejection reason"));
  });

  it("should no-op when handleCrash is called while inactive", () => {
    const guard = new CrashGuard();
    const events: CrashEvent[] = [];
    guard.on("crash", (e: CrashEvent) => {
      events.push(e);
    });

    // active = false (default)
    (guard as any).handleCrash("uncaughtException", new Error("ignored"));
    assert.strictEqual(events.length, 0, "Should not emit when inactive");
  });

  it("disable() should be idempotent (safe to call when already disabled)", () => {
    const guard = new CrashGuard();
    assert.doesNotThrow(() => {
      guard.disable();
      guard.disable();
    });
  });

  it("enable() followed by disable() should cleanly remove listeners", () => {
    process.env.NODE_ENV = "test";
    const guard = new CrashGuard();

    guard.enable();
    assert.strictEqual((guard as any).active, true);

    guard.disable();
    assert.strictEqual((guard as any).active, false);
  });

  it("should NOT call process.exit in test mode (NODE_ENV=test)", (_, done) => {
    process.env.NODE_ENV = "test";

    const guard = new CrashGuard();
    (guard as any).active = true;

    let exited = false;
    const originalExit = process.exit;
    (process as any).exit = () => {
      exited = true;
    };

    try {
      (guard as any).handleCrash("uncaughtException", new Error("test exit check"));
    } finally {
      setTimeout(() => {
        (process as any).exit = originalExit;
        assert.strictEqual(exited, false, "process.exit should NOT be called in test mode");
        done();
      }, 150);
    }
  });

  it("should resolve stack via custom resolver", () => {
    process.env.NODE_ENV = "test";
    const guard = new CrashGuard((stack) => `RESOLVED:${stack}`);
    const events: CrashEvent[] = [];
    guard.on("crash", (e: CrashEvent) => {
      events.push(e);
    });

    (guard as any).active = true;
    const err = new Error("mapped crash");
    (guard as any).handleCrash("uncaughtException", err);

    assert.ok(events.length > 0);
    assert.ok(events[0].resolvedStack?.startsWith("RESOLVED:"));
  });

  it("should produce undefined resolvedStack when error has no stack", () => {
    process.env.NODE_ENV = "test";
    const guard = new CrashGuard();
    const events: CrashEvent[] = [];
    guard.on("crash", (e: CrashEvent) => {
      events.push(e);
    });

    (guard as any).active = true;
    const err = new Error("no stack");
    delete err.stack;
    (guard as any).handleCrash("uncaughtException", err);

    assert.ok(events.length > 0);
    assert.strictEqual(events[0].resolvedStack, undefined);
  });

  it("handleUncaughtException: should call handleCrash with the error", () => {
    process.env.NODE_ENV = "test";
    const guard = new CrashGuard();
    const events: CrashEvent[] = [];
    guard.on("crash", (e: CrashEvent) => {
      events.push(e);
    });

    guard.enable();

    const testError = new Error("arrow fn crash");
    (guard as any).handleUncaughtException(testError);

    guard.disable();

    assert.ok(events.length > 0, "Should have emitted crash event");
    assert.strictEqual(events[0].type, "uncaughtException");
    assert.strictEqual(events[0].error, testError);
  });

  it("should call process.exit(1) when NODE_ENV is not test", (_, done) => {
    const originalEnv = process.env.NODE_ENV;
    const originalExit = process.exit;

    let exitCode: number | undefined;
    (process as any).exit = (code: number) => {
      exitCode = code;
    };
    process.env.NODE_ENV = "production";

    const guard = new CrashGuard();
    (guard as any).active = true;

    (guard as any).handleCrash("uncaughtException", new Error("prod crash"));

    setTimeout(() => {
      (process as any).exit = originalExit;
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;

      assert.strictEqual(exitCode, 1, "process.exit(1) should have been called in production");
      done();
    }, 200);
  });

  it("[BUG FIX] unhandledRejection should NOT call process.exit even in production", (_, done) => {
    const originalEnv = process.env.NODE_ENV;
    const originalExit = process.exit;

    let exitCode: number | undefined;
    (process as any).exit = (code: number) => {
      exitCode = code;
    };
    process.env.NODE_ENV = "production";

    const guard = new CrashGuard();
    (guard as any).active = true;

    (guard as any).handleCrash("unhandledRejection", new Error("rejected promise"));

    setTimeout(() => {
      (process as any).exit = originalExit;
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;

      assert.strictEqual(
        exitCode,
        undefined,
        "process.exit should NOT be called for unhandledRejection",
      );
      done();
    }, 200);
  });

  it("[BUG FIX] unhandledRejection should still emit crash event without killing process", () => {
    process.env.NODE_ENV = "test";
    const guard = new CrashGuard();
    const events: CrashEvent[] = [];
    guard.on("crash", (e: CrashEvent) => {
      events.push(e);
    });
    (guard as any).active = true;

    (guard as any).handleCrash("unhandledRejection", new Error("async failure"));

    assert.ok(events.length > 0, "Should emit crash event");
    assert.strictEqual(events[0].type, "unhandledRejection");
    assert.ok(
      !events[0].suggestions![0].message.includes("tearing down"),
      "Should not say tearing down",
    );
  });
});
