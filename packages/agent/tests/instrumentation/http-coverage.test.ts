/**
 * Additional coverage tests for HttpInstrumentation
 * Targets: request 'error' event path (line 71), disable() idempotency (line 81)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { HttpInstrumentation, type TracedHttpRequest } from "../../src/instrumentation/http.ts";

describe("HttpInstrumentation (coverage)", () => {
  // ── Request error event path ──────────────────────────────────────────────
  it("should emit request event with error when HTTP request fails", async () => {
    const instr = new HttpInstrumentation(() => undefined);
    const events: TracedHttpRequest[] = [];
    instr.on("request", (req) => events.push(req));
    instr.enable();

    // Make a request to an intentionally closed/unreachable port
    const req = http.request({ host: "localhost", port: 1, path: "/" });
    req.end();

    await new Promise<void>((resolve) => {
      req.on("error", () => {
        // Give the channel listener time to process
        setTimeout(resolve, 50);
      });
    });

    instr.disable();

    // The error branch in HttpInstrumentation should have fired
    assert.strictEqual(events.length, 1, "Should have emitted one traced request on error");
    assert.ok(typeof events[0].error === "string", "Should have an error message string");
    assert.strictEqual(events[0].statusCode, undefined, "No status code on error");
  });

  // ── disable() idempotency ─────────────────────────────────────────────────
  it("disable() should be safe when called without enable()", () => {
    const instr = new HttpInstrumentation(() => undefined);
    assert.doesNotThrow(() => {
      instr.disable();
      instr.disable();
    });
  });

  // ── enable() idempotency ──────────────────────────────────────────────────
  it("enable() should be a no-op on the second call", () => {
    const instr = new HttpInstrumentation(() => undefined);
    instr.enable();
    const listenerBefore = (instr as any).channelListener;
    instr.enable(); // second call
    const listenerAfter = (instr as any).channelListener;
    assert.strictEqual(listenerBefore, listenerAfter, "Listener should not be replaced");
    instr.disable();
  });
});
