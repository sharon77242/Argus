/**
 * Tests for safe-channel.ts — backward-compatible diagnostics_channel loader.
 * Also covers the HttpInstrumentation monkey-patch path (Node < 18 fallback).
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  getDiagnosticsChannel,
  safeChannel,
  supportsHttpDiagnosticsChannel,
} from "../../src/instrumentation/safe-channel.ts";
import { HttpInstrumentation, type TracedHttpRequest } from "../../src/instrumentation/http.ts";
import { type AddressInfo } from "node:net";

// ── safe-channel utility ───────────────────────────────────────────────────

describe("getDiagnosticsChannel", () => {
  it("returns the diagnostics_channel module", () => {
    const dc = getDiagnosticsChannel();
    assert.strictEqual(typeof dc.channel, "function");
  });

  it("returns the same module reference on repeated calls", () => {
    assert.strictEqual(getDiagnosticsChannel(), getDiagnosticsChannel());
  });
});

describe("safeChannel", () => {
  it("returns a channel object with subscribe/unsubscribe/publish", () => {
    const ch = safeChannel("test.safe-channel.noop");
    assert.strictEqual(typeof ch.subscribe, "function");
    assert.strictEqual(typeof ch.unsubscribe, "function");
    assert.strictEqual(typeof ch.publish, "function");
  });

  it("subscribe/publish/unsubscribe work end-to-end", () => {
    const ch = safeChannel("test.safe-channel.roundtrip");
    const received: unknown[] = [];
    const listener = (msg: unknown) => received.push(msg);

    ch.subscribe(listener);
    ch.publish({ hello: "world" });
    ch.unsubscribe(listener);
    ch.publish({ hello: "ignored" }); // after unsubscribe

    assert.strictEqual(received.length, 1);
    assert.deepEqual(received[0], { hello: "world" });
  });
});

describe("supportsHttpDiagnosticsChannel", () => {
  it("returns a boolean", () => {
    assert.strictEqual(typeof supportsHttpDiagnosticsChannel(), "boolean");
  });

  it("returns true on Node 18+ (current test environment is >= 22)", () => {
    // The test suite requires Node 22+ so this should always be true.
    const major = parseInt(process.versions.node.split(".")[0], 10);
    const expected = major >= 18;
    assert.strictEqual(supportsHttpDiagnosticsChannel(), expected);
  });
});

// ── HttpInstrumentation monkey-patch fallback ─────────────────────────────

describe("HttpInstrumentation — monkey-patch fallback (simulated Node < 18)", () => {
  let instrumentation: HttpInstrumentation;

  afterEach(() => {
    instrumentation?.disable();
  });

  it("monkey-patch path traces http.request correctly", async () => {
    // Simulate Node < 18 by force-enabling the monkey-patch path.
    // We subclass HttpInstrumentation and override the path selector.
    class MonkeyPatchHttp extends HttpInstrumentation {
      override enable(): void {
        if ((this as any).active) return;
        (this as any)._enableMonkeyPatch();
        (this as any).active = true;
      }
    }

    instrumentation = new MonkeyPatchHttp(() => "test.ts:1");
    const traced: TracedHttpRequest[] = [];
    instrumentation.on("request", (r) => traced.push(r));

    // Start a local server
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    instrumentation.enable();

    // Make a request through the patched http.request
    const req = http.request(`http://localhost:${port}/monkey-path`, (res) => {
      res.resume(); // drain body
    });
    req.end();

    await new Promise<void>((resolve) => req.on("close", resolve));
    await new Promise((r) => setTimeout(r, 20)); // allow event to propagate

    instrumentation.disable();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    assert.strictEqual(traced.length, 1, "should have traced exactly one request");
    assert.strictEqual(traced[0].method, "GET");
    assert.ok(traced[0].url.includes("/monkey-path"));
    assert.strictEqual(traced[0].statusCode, 200);
    assert.ok(traced[0].durationMs >= 0);
  });

  it("disable() restores the original http.request", () => {
    class MonkeyPatchHttp extends HttpInstrumentation {
      override enable(): void {
        if ((this as any).active) return;
        (this as any)._enableMonkeyPatch();
        (this as any).active = true;
      }
    }

    const originalRequest = http.request;

    instrumentation = new MonkeyPatchHttp(() => undefined);
    instrumentation.enable();

    // After enable, http.request should be replaced
    assert.notStrictEqual(http.request, originalRequest, "http.request should be patched");

    instrumentation.disable();

    // After disable, http.request should be restored
    assert.strictEqual(http.request, originalRequest, "http.request should be restored");
  });

  it("parseArgs handles string URL", async () => {
    class MonkeyPatchHttp extends HttpInstrumentation {
      override enable(): void {
        if ((this as any).active) return;
        (this as any)._enableMonkeyPatch();
        (this as any).active = true;
      }
    }

    instrumentation = new MonkeyPatchHttp(() => undefined);
    const traced: TracedHttpRequest[] = [];
    instrumentation.on("request", (r) => traced.push(r));

    const server = http.createServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    instrumentation.enable();
    const req = http.request(
      { host: "localhost", port, path: "/opts-path", method: "POST" },
      (res) => res.resume(),
    );
    req.end();

    await new Promise<void>((resolve) => req.on("close", resolve));
    await new Promise((r) => setTimeout(r, 20));

    instrumentation.disable();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    assert.strictEqual(traced.length, 1);
    assert.strictEqual(traced[0].method, "POST");
    assert.ok(traced[0].url.includes("/opts-path"));
  });
});
