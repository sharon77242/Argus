import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { type AddressInfo } from "node:net";
import { HttpInstrumentation, type TracedHttpRequest } from "../../src/instrumentation/http.ts";
import { runWithContext, createRequestContext } from "../../src/instrumentation/correlation.ts";

describe("HttpInstrumentation", () => {
  it("should trace an outgoing HTTP request using diagnostics channel", async () => {
    const instrumentation = new HttpInstrumentation(() => "test.ts:1");
    const requests: TracedHttpRequest[] = [];

    instrumentation.on("request", (req: TracedHttpRequest) => {
      requests.push(req);
    });

    instrumentation.enable();

    const server = http.createServer((res, req) => {
      req.writeHead(200);
      req.end("ok");
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    const req = http.request(`http://localhost:${port}/test-path`, (res) => {
      res.on("data", () => {});
    });
    req.end();

    await new Promise<void>((resolve) => {
      req.on("close", resolve);
    });
    await new Promise((r) => setTimeout(r, 10));

    instrumentation.disable();
    server.close();

    assert.ok(requests.length > 0, "Should have traced request");
    assert.strictEqual(requests[0].method, "GET");
    assert.ok(requests[0].url.includes("/test-path"));
    assert.ok(typeof requests[0].durationMs === "number");
    assert.strictEqual(requests[0].statusCode, 200);
  });

  it("should include correlationId when request is wrapped in runWithContext", async () => {
    const instrumentation = new HttpInstrumentation(() => "test.ts:1");
    const requests: TracedHttpRequest[] = [];

    instrumentation.on("request", (req: TracedHttpRequest) => {
      requests.push(req);
    });

    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const ctx = createRequestContext("GET", `/corr-test`);

    await runWithContext(ctx, async () => {
      instrumentation.enable();

      const req = http.request(`http://localhost:${port}/corr-test`, (res) => {
        res.on("data", () => {});
      });
      req.end();

      await new Promise<void>((resolve) => req.on("close", resolve));
      await new Promise((r) => setTimeout(r, 10));

      instrumentation.disable();
    });

    server.close();

    assert.ok(requests.length > 0, "Should have traced request");
    assert.equal(
      requests[0].correlationId,
      ctx.requestId,
      "correlationId should match the request context requestId",
    );
  });

  // Bug: instrumentation listened for 'close' on the response instead of 'end'.
  // On HTTP keep-alive connections the socket never closes promptly, so 'close' on
  // IncomingMessage fires only when the connection eventually times out — meaning
  // the "request" telemetry event could be delayed by seconds or never arrive.
  // The fix is to listen for 'end', which fires as soon as the response body is consumed.
  it("should emit the 'request' event before the socket closes (end semantics)", async () => {
    const instrumentation = new HttpInstrumentation(() => undefined);
    const events: TracedHttpRequest[] = [];
    instrumentation.on("request", (r) => events.push(r));
    instrumentation.enable();

    // Server with keep-alive enabled (Node.js default) — it will NOT close the socket
    // after the response, so IncomingMessage 'close' would only fire after the timeout.
    const server = http.createServer((_req, res) => {
      res.setHeader("Connection", "keep-alive");
      res.writeHead(200);
      res.end("hello");
    });

    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as { port: number };

    const req = http.request(`http://localhost:${port}/`, (res) => {
      res.on("data", () => {}); // consume so 'end' fires
    });
    req.end();

    // Wait enough for 'end' to fire (few ms), but not for keep-alive timeout (5 000ms)
    await new Promise((r) => setTimeout(r, 50));

    instrumentation.disable();
    // Force-close all connections so the port is released immediately
    (server as any).closeAllConnections?.();
    server.close();

    assert.strictEqual(events.length, 1, "'request' event must fire before socket closes");
    assert.strictEqual(events[0].statusCode, 200);
  });

  it("should not include correlationId when request is outside runWithContext", async () => {
    const instrumentation = new HttpInstrumentation(() => "test.ts:1");
    const requests: TracedHttpRequest[] = [];

    instrumentation.on("request", (req: TracedHttpRequest) => {
      requests.push(req);
    });

    instrumentation.enable();

    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const req = http.request(`http://localhost:${port}/no-context`, (res) => {
      res.on("data", () => {});
    });
    req.end();
    await new Promise<void>((resolve) => req.on("close", resolve));
    await new Promise((r) => setTimeout(r, 10));

    instrumentation.disable();
    server.close();

    assert.ok(requests.length > 0, "Should have traced request");
    assert.equal(
      requests[0].correlationId,
      undefined,
      "correlationId should be undefined outside runWithContext",
    );
  });
});
