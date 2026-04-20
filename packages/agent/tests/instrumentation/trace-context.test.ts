import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createRequestContext,
  parseTraceparent,
  makeTraceparent,
  runWithContext,
  getCurrentContext,
} from "../../src/instrumentation/correlation.ts";

describe("parseTraceparent", () => {
  it("parses a valid traceparent header", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const spanId = "00f067aa0ba902b7";
    const result = parseTraceparent(`00-${traceId}-${spanId}-01`);
    assert.deepStrictEqual(result, { traceId, spanId });
  });

  it("returns null for undefined", () => {
    assert.strictEqual(parseTraceparent(undefined), null);
  });

  it("returns null for empty string", () => {
    assert.strictEqual(parseTraceparent(""), null);
  });

  it("returns null for wrong version prefix", () => {
    assert.strictEqual(
      parseTraceparent("01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
      null,
    );
  });

  it("returns null when traceId is wrong length", () => {
    assert.strictEqual(parseTraceparent("00-tooshort-00f067aa0ba902b7-01"), null);
  });

  it("returns null when spanId is wrong length", () => {
    assert.strictEqual(parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-tooshort-01"), null);
  });

  it("returns null for non-hex characters", () => {
    assert.strictEqual(
      parseTraceparent("00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-00f067aa0ba902b7-01"),
      null,
    );
  });

  it("accepts an array and uses the first element", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const spanId = "00f067aa0ba902b7";
    const result = parseTraceparent([`00-${traceId}-${spanId}-01`, "ignored"]);
    assert.deepStrictEqual(result, { traceId, spanId });
  });
});

describe("makeTraceparent", () => {
  it("produces a valid W3C traceparent string", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const spanId = "00f067aa0ba902b7";
    const header = makeTraceparent(traceId, spanId);
    assert.strictEqual(header, `00-${traceId}-${spanId}-01`);
  });

  it("round-trips through parseTraceparent", () => {
    const traceId = "abc123".padEnd(32, "0");
    const spanId = "def456".padEnd(16, "0");
    const header = makeTraceparent(traceId, spanId);
    const parsed = parseTraceparent(header);
    assert.deepStrictEqual(parsed, { traceId, spanId });
  });
});

describe("createRequestContext", () => {
  it("generates a fresh traceId and spanId when no traceparent supplied", () => {
    const ctx = createRequestContext("GET", "/api/test");
    assert.strictEqual(ctx.traceId.length, 32);
    assert.strictEqual(ctx.spanId.length, 16);
    assert.ok(/^[0-9a-f]+$/.test(ctx.traceId));
    assert.ok(/^[0-9a-f]+$/.test(ctx.spanId));
    assert.strictEqual(ctx.method, "GET");
    assert.strictEqual(ctx.url, "/api/test");
    assert.ok(ctx.requestId.length > 0);
  });

  it("inherits traceId from an incoming traceparent header", () => {
    const incomingTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const incomingSpanId = "00f067aa0ba902b7";
    const ctx = createRequestContext(
      "POST",
      "/users",
      `00-${incomingTraceId}-${incomingSpanId}-01`,
    );
    assert.strictEqual(ctx.traceId, incomingTraceId, "traceId must be inherited");
    assert.notStrictEqual(ctx.spanId, incomingSpanId, "spanId must be a new span for this hop");
  });

  it("generates a fresh traceId when traceparent is malformed", () => {
    const ctx = createRequestContext("GET", "/", "not-a-traceparent");
    assert.strictEqual(ctx.traceId.length, 32);
  });

  it("each call generates a unique traceId and spanId", () => {
    const a = createRequestContext();
    const b = createRequestContext();
    assert.notStrictEqual(a.traceId, b.traceId);
    assert.notStrictEqual(a.spanId, b.spanId);
  });
});

describe("runWithContext / getCurrentContext traceId propagation", () => {
  it("propagates traceId through async call chain", async () => {
    const ctx = createRequestContext("GET", "/traced");

    const traceIds: string[] = [];
    await runWithContext(ctx, async () => {
      await Promise.resolve();
      traceIds.push(getCurrentContext()?.traceId ?? "");
      await new Promise<void>((r) => setTimeout(r, 0));
      traceIds.push(getCurrentContext()?.traceId ?? "");
    });

    assert.strictEqual(traceIds.length, 2);
    assert.strictEqual(traceIds[0], ctx.traceId);
    assert.strictEqual(traceIds[1], ctx.traceId);
  });

  it("getCurrentContext returns undefined outside runWithContext", () => {
    const ctx = getCurrentContext();
    assert.strictEqual(ctx, undefined);
  });

  it("nested runWithContext scopes are isolated", () => {
    const outer = createRequestContext("GET", "/outer");
    const inner = createRequestContext("GET", "/inner");

    let outerTrace: string | undefined;
    let innerTrace: string | undefined;

    runWithContext(outer, () => {
      outerTrace = getCurrentContext()?.traceId;
      runWithContext(inner, () => {
        innerTrace = getCurrentContext()?.traceId;
      });
      // After inner scope, outer context is restored
      assert.strictEqual(getCurrentContext()?.traceId, outerTrace);
    });

    assert.strictEqual(outerTrace, outer.traceId);
    assert.strictEqual(innerTrace, inner.traceId);
    assert.notStrictEqual(outerTrace, innerTrace);
  });
});
