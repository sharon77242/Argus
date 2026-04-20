import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeChannel } from "../../src/instrumentation/safe-channel.ts";
import { wrapMethod, PATCHED_SYMBOL } from "../../src/instrumentation/drivers/patch-utils.ts";
import type { PatchedQueryMessage } from "../../src/instrumentation/drivers/patch-utils.ts";

describe("wrapMethod — captureHit", () => {
  // ── promise path ──────────────────────────────────────────────────────────

  it("publishes cacheHit=true when captureHit returns true (promise path)", async () => {
    const target = {
      get: (_key: string) => Promise.resolve("value"),
    };

    wrapMethod(target, "get", "redis-test-hit", undefined, (r) => r !== null);

    const messages: PatchedQueryMessage[] = [];
    const listener = (msg: unknown) => messages.push(msg as PatchedQueryMessage);
    safeChannel("db.query.execution").subscribe(listener);

    await (target.get as (k: string) => Promise<string>)("mykey");
    safeChannel("db.query.execution").unsubscribe(listener);

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].cacheHit, true);
  });

  it("publishes cacheHit=false when captureHit returns false (promise path — null result)", async () => {
    const target = {
      get: (_key: string) => Promise.resolve(null),
    };

    wrapMethod(target, "get", "redis-test-miss", undefined, (r) => r !== null);

    const messages: PatchedQueryMessage[] = [];
    const listener = (msg: unknown) => messages.push(msg as PatchedQueryMessage);
    safeChannel("db.query.execution").subscribe(listener);

    await (target.get as (k: string) => Promise<null>)("missingkey");
    safeChannel("db.query.execution").unsubscribe(listener);

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].cacheHit, false);
  });

  it("does not set cacheHit when captureHit is not provided (promise path)", async () => {
    const target = {
      query: (_sql: string) => Promise.resolve({ rows: [] }),
    };

    wrapMethod(target, "query", "pg-no-cachehit");

    const messages: PatchedQueryMessage[] = [];
    const listener = (msg: unknown) => messages.push(msg as PatchedQueryMessage);
    safeChannel("db.query.execution").subscribe(listener);

    await (target.query as (s: string) => Promise<unknown>)("SELECT 1");
    safeChannel("db.query.execution").unsubscribe(listener);

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].cacheHit, undefined);
  });

  // ── callback path ─────────────────────────────────────────────────────────

  it("publishes cacheHit=true for callback path when result is non-null", async () => {
    const target = {
      get: (key: string, cb: (err: null, result: string) => void) => {
        cb(null, "cached-value");
      },
    };

    wrapMethod(target, "get", "redis-cb-hit", undefined, (r) => r !== null);

    const messages: PatchedQueryMessage[] = [];
    const listener = (msg: unknown) => messages.push(msg as PatchedQueryMessage);
    safeChannel("db.query.execution").subscribe(listener);

    await new Promise<void>((resolve) => {
      (target.get as (k: string, cb: (e: null, r: string) => void) => void)(
        "key",
        () => resolve(),
      );
    });
    safeChannel("db.query.execution").unsubscribe(listener);

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].cacheHit, true);
  });

  // ── sync path ─────────────────────────────────────────────────────────────

  it("publishes cacheHit when result is captured synchronously", () => {
    const target = {
      getSync: (_key: string): string | null => "sync-value",
    };

    wrapMethod(target, "getSync", "redis-sync-hit", undefined, (r) => r !== null);

    const messages: PatchedQueryMessage[] = [];
    const listener = (msg: unknown) => messages.push(msg as PatchedQueryMessage);
    safeChannel("db.query.execution").subscribe(listener);

    (target.getSync as (k: string) => string)("k");
    safeChannel("db.query.execution").unsubscribe(listener);

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].cacheHit, true);
  });

  it("PATCHED_SYMBOL is set on wrapped functions", () => {
    const target = { fn: () => null };
    wrapMethod(target, "fn", "sym-test");
    assert.strictEqual(
      (target.fn as unknown as Record<symbol, unknown>)[PATCHED_SYMBOL],
      true,
    );
  });
});
