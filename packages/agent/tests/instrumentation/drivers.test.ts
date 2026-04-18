import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import diagnostics_channel from "node:diagnostics_channel";

import {
  patchMethod,
  removeDriverPatches,
  AUTO_PATCH_CHANNEL,
  type PatchedQueryMessage,
} from "../../src/instrumentation/drivers/index.ts";

describe("Driver Auto-Patching", () => {
  afterEach(() => {
    removeDriverPatches();
  });

  it("should patch a mock prototype and publish query timing to diagnostics_channel", async () => {
    // Simulate a DB driver prototype with a promise-based query method
    const mockProto = {
      query: async function (_sql: string) {
        return { rows: [{ id: 1 }] };
      },
    };

    patchMethod(mockProto, "query", "mock-driver");

    // Subscribe to the channel to verify a message arrives
    const channel = diagnostics_channel.channel(AUTO_PATCH_CHANNEL);
    const messagePromise = new Promise<PatchedQueryMessage>((resolve) => {
      const listener = (message: PatchedQueryMessage) => {
        channel.unsubscribe(listener);
        resolve(message);
      };
      channel.subscribe(listener);
    });

    // Call the patched method
    const result = await mockProto.query("SELECT * FROM users WHERE id = 1");

    // Verify the original function still returns correctly
    assert.deepStrictEqual(result, { rows: [{ id: 1 }] });

    // Verify diagnostics_channel message was published
    const msg = await messagePromise;
    assert.strictEqual(msg.query, "SELECT * FROM users WHERE id = 1");
    assert.strictEqual(msg.driver, "mock-driver");
    assert.ok(typeof msg.durationMs === "number");
    assert.ok(msg.durationMs >= 0);
  });

  it("should patch callback-style methods correctly", (_, done) => {
    const mockProto = {
      query: function (sql: string, callback: (err: any, result: any) => void) {
        setTimeout(() => callback(null, { rows: [] }), 5);
      },
    };

    patchMethod(mockProto, "query", "mock-cb-driver");

    const channel = diagnostics_channel.channel(AUTO_PATCH_CHANNEL);
    const listener = (message: PatchedQueryMessage) => {
      channel.unsubscribe(listener);
      assert.strictEqual(message.query, "SELECT 1");
      assert.strictEqual(message.driver, "mock-cb-driver");
      done();
    };
    channel.subscribe(listener);

    mockProto.query("SELECT 1", (err, result) => {
      assert.strictEqual(err, null);
      assert.deepStrictEqual(result, { rows: [] });
    });
  });

  it("should not double-patch the same method", () => {
    const mockProto = {
      query: async function (sql: string) {
        return sql;
      },
    };

    patchMethod(mockProto, "query", "test");
    const firstWrapped = mockProto.query;

    patchMethod(mockProto, "query", "test"); // second call — should be a no-op
    assert.strictEqual(mockProto.query, firstWrapped);
  });

  it("should cleanly remove patches on removeDriverPatches()", async () => {
    const original = async function (_sql: string) {
      return "original";
    };
    const mockProto = { query: original };

    patchMethod(mockProto, "query", "test");
    assert.notStrictEqual(mockProto.query, original);

    removeDriverPatches();
    assert.strictEqual(mockProto.query, original);
  });

  it("should handle config-object style arguments", async () => {
    const mockProto = {
      query: async function (_config: { text: string; values: any[] }) {
        return { rows: [] };
      },
    };

    patchMethod(mockProto, "query", "config-driver");

    const channel = diagnostics_channel.channel(AUTO_PATCH_CHANNEL);
    const messagePromise = new Promise<PatchedQueryMessage>((resolve) => {
      const listener = (message: PatchedQueryMessage) => {
        channel.unsubscribe(listener);
        resolve(message);
      };
      channel.subscribe(listener);
    });

    await mockProto.query({ text: "INSERT INTO orders VALUES ($1)", values: [42] });

    const msg = await messagePromise;
    assert.strictEqual(msg.query, "INSERT INTO orders VALUES ($1)");
  });
});
