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
