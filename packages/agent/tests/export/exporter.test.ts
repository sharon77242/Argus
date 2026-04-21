import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { OTLPExporter } from "../../src/export/exporter.ts";
import https from "node:https";
import type { AggregatorEvent } from "../../src/export/aggregator.ts";
import { EventEmitter } from "node:events";

describe("OTLPExporter", () => {
  it("should correctly format events to OTLP JSON payload", () => {
    const exporter = new OTLPExporter({
      endpointUrl: "https://localhost",
      key: "test",
      cert: "test",
      ca: "test",
    });

    const mockEvents: AggregatorEvent[] = [
      { id: "1", metricName: "query", value: 100, payload: { query: "SELECT * FROM users" } },
    ];

    const payload = exporter.formatToOTLP(mockEvents);

    assert.ok(payload.resourceSpans[0].scopeSpans[0].spans.length === 1);
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];

    assert.strictEqual(span.name, "query");
    assert.ok(span.traceId.length === 32);
    assert.ok(span.spanId.length === 16);
    assert.strictEqual(
      span.attributes.find(
        (a: { key: string; value: { doubleValue?: number } }) => a.key === "diagnostic.value",
      )?.value.doubleValue,
      100,
    );
  });

  it("uses traceId from payload when present instead of generating a random one", () => {
    const exporter = new OTLPExporter({
      endpointUrl: "https://localhost",
      key: "test",
      cert: "test",
      ca: "test",
    });

    const knownTraceId = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
    const events: AggregatorEvent[] = [
      { id: "1", metricName: "query", value: 50, payload: { traceId: knownTraceId } },
    ];

    const payload = exporter.formatToOTLP(events);
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];

    assert.strictEqual(span.traceId, knownTraceId);
  });

  it("falls back to a random traceId when payload has no traceId", () => {
    const exporter = new OTLPExporter({
      endpointUrl: "https://localhost",
      key: "test",
      cert: "test",
      ca: "test",
    });

    const events: AggregatorEvent[] = [{ id: "1", metricName: "query", value: 50, payload: {} }];

    const payload = exporter.formatToOTLP(events);
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];

    assert.ok(span.traceId.length === 32, "fallback traceId must be 32 hex chars");
    assert.ok(/^[0-9a-f]+$/.test(span.traceId), "fallback traceId must be hex");
  });

  // Bug: retry delay used retryDelayMs * attempt (linear) but JSDoc promised "doubles each attempt".
  // With maxRetries=3 the 3rd retry diverges: linear gives 300ms, exponential gives 400ms.
  it("should use exponential backoff — delay doubles each retry attempt", async () => {
    const capturedDelays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    // Capture delay values; fire immediately so the test doesn't actually wait
    (globalThis as any).setTimeout = function (fn: () => void, ms?: number) {
      if (typeof ms === "number" && ms >= 100) capturedDelays.push(ms);
      return origSetTimeout(fn, 0);
    };

    const requestMock = mock.method(https, "request", (_opts: unknown, callback?: unknown) => {
      const reqMock = new EventEmitter() as any;
      reqMock.write = () => {};
      reqMock.end = () => {};
      reqMock.destroy = () => {};
      const resMock = new EventEmitter() as any;
      resMock.statusCode = 503; // always retryable
      process.nextTick(() => {
        if (typeof callback === "function") callback(resMock);
        resMock.emit("end");
      });
      return reqMock;
    });

    const exporter = new OTLPExporter({
      endpointUrl: "https://example.com/v1/traces",
      key: "k",
      cert: "c",
      ca: "ca",
      maxRetries: 3,
      retryDelayMs: 100,
    });

    try {
      await exporter.export([
        { id: "1", metricName: "lag", value: 50, payload: { timestamp: Date.now() } },
      ]);
    } catch {
      // all 4 attempts failed — expected
    } finally {
      (globalThis as any).setTimeout = origSetTimeout;
      requestMock.mock.restore();
    }

    // attempt 1: 100*2^0=100  attempt 2: 100*2^1=200  attempt 3: 100*2^2=400
    // (linear would give 100, 200, 300 — fails on the last value)
    assert.deepStrictEqual(capturedDelays, [100, 200, 400], "delays must be exponential");
  });

  it("should construct mTLS options using node:https request correctly", async () => {
    const mockRequest = mock.method(https, "request", (options: any, callback?: any) => {
      // Assert mTLS options are populated exactly
      assert.strictEqual(options.key, "mock-key");
      assert.strictEqual(options.cert, "mock-cert");
      assert.strictEqual(options.ca, "mock-ca");
      assert.strictEqual(options.rejectUnauthorized, true);
      assert.strictEqual(options.hostname, "datadog.example.com");
      assert.strictEqual(options.method, "POST");

      const reqMock = new EventEmitter() as any;
      reqMock.write = () => {};
      reqMock.end = () => {};
      reqMock.destroy = () => {};

      // Simulate HTTP 200 response
      const resMock = new EventEmitter() as any;
      resMock.statusCode = 200;

      // Fire callback async to mimic network
      process.nextTick(() => {
        if (callback) callback(resMock);
        resMock.emit("end");
      });

      return reqMock;
    });

    const exporter = new OTLPExporter({
      endpointUrl: "https://datadog.example.com/v1/traces",
      key: "mock-key",
      cert: "mock-cert",
      ca: "mock-ca",
    });

    await exporter.export([
      {
        id: "uuid",
        metricName: "event-loop-lag",
        value: 60,
        payload: { lagMs: 60, timestamp: Date.now() },
      },
    ]);

    assert.strictEqual(mockRequest.mock.calls.length, 1);
  });
});
