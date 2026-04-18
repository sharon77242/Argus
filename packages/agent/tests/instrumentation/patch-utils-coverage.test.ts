/**
 * Additional coverage tests for patch-utils
 * Targets: promise rejection path (lines 91-100), synchronous no-promise fallback (lines 104-111),
 *          wrapMethod with non-object queryArg (default to String())
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import diagnostics_channel from "node:diagnostics_channel";
import {
  AUTO_PATCH_CHANNEL,
  wrapMethod,
  activePatches,
  patchMethod,
  type PatchedQueryMessage,
} from "../../src/instrumentation/drivers/patch-utils.ts";

describe("patch-utils (coverage)", () => {
  afterEach(() => {
    // Clean up patches
    while (activePatches.length > 0) {
      const p = activePatches.pop()!;
      p.target[p.methodName] = p.original;
    }
  });

  // ── Promise rejection path (lines 91-100) ─────────────────────────────────
  it("should publish to channel with error when promise-style method rejects", async () => {
    const mockProto = {
      query: async (_sql: string) => {
        throw new Error("DB error");
      },
    };

    wrapMethod(mockProto, "query", "test-reject");

    const ch = diagnostics_channel.channel(AUTO_PATCH_CHANNEL);
    const messages: PatchedQueryMessage[] = [];
    const listener = (msg: PatchedQueryMessage) => messages.push(msg);
    ch.subscribe(listener);

    try {
      await assert.rejects(() => mockProto.query("SELECT 1"), /DB error/);

      assert.strictEqual(messages.length, 1, "Should have published one message");
      assert.ok(messages[0].error instanceof Error, "Error should be propagated to channel");
      assert.strictEqual(messages[0].query, "SELECT 1");
    } finally {
      ch.unsubscribe(listener);
    }
  });

  // ── Synchronous (non-promise) fallback (lines 104-111) ───────────────────
  it("should publish to channel when method returns synchronously (no promise)", () => {
    const mockProto = {
      exec: (_sql: string): string => "ok", // returns string, not a Promise
    };

    wrapMethod(mockProto, "exec", "sync-driver");

    const ch = diagnostics_channel.channel(AUTO_PATCH_CHANNEL);
    const messages: PatchedQueryMessage[] = [];
    const listener = (msg: PatchedQueryMessage) => messages.push(msg);
    ch.subscribe(listener);

    try {
      const result = mockProto.exec("INSERT INTO t VALUES (1)");
      assert.strictEqual(result, "ok", "Should pass through return value");
      assert.strictEqual(messages.length, 1, "Should have published one message");
      assert.strictEqual(messages[0].query, "INSERT INTO t VALUES (1)");
      assert.strictEqual(messages[0].driver, "sync-driver");
    } finally {
      ch.unsubscribe(listener);
    }
  });

  // ── queryArg is not a string or object with .text (falls back to String()) ─
  it("should coerce non-string, non-object query arg to String", async () => {
    const mockProto = {
      query: async (_q: any) => "done",
    };

    wrapMethod(mockProto, "query", "coerce-driver");

    const ch = diagnostics_channel.channel(AUTO_PATCH_CHANNEL);
    const messages: PatchedQueryMessage[] = [];
    const listener = (msg: PatchedQueryMessage) => messages.push(msg);
    ch.subscribe(listener);

    try {
      await mockProto.query(42 as any); // number arg → String(42) = '42'
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].query, "42");
    } finally {
      ch.unsubscribe(listener);
    }
  });

  // ── patchMethod: already patched → no-op ─────────────────────────────────
  it("patchMethod should skip when method is already patched", () => {
    const mockProto = {
      query: async (_sql: string) => "ok",
    };

    patchMethod(mockProto, "query", "driver-a");
    const firstWrapped = mockProto.query;
    const sizeBefore = activePatches.length;

    patchMethod(mockProto, "query", "driver-b"); // should be no-op
    assert.strictEqual(mockProto.query, firstWrapped, "Should not re-wrap");
    assert.strictEqual(activePatches.length, sizeBefore, "Should not push another patch record");
  });

  // ── Bug Fix #4 regression: wrapMethod must be idempotent ─────────────────
  it("[BUG FIX] wrapMethod called twice should not push duplicate entries to activePatches", () => {
    const mockProto = {
      execute: (_sql: string) => "result" as any,
    };

    const countBefore = activePatches.length;

    // First call: patches and records
    wrapMethod(mockProto, "execute", "test-driver");
    const countAfterFirst = activePatches.length;
    assert.strictEqual(countAfterFirst, countBefore + 1, "Should push one entry on first call");

    // Second call: should be a no-op because isAlreadyPatched returns true
    wrapMethod(mockProto, "execute", "test-driver");
    assert.strictEqual(
      activePatches.length,
      countAfterFirst,
      "[BUG FIX] wrapMethod must not push duplicate entries when called twice",
    );
  });
});
