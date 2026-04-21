/**
 * Coverage tests for ArgusAgent — ARGUS_DEBUG, useConsoleLogger,
 * and remaining uncovered start/stop branches.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ArgusAgent } from "../src/argus-agent.ts";

describe("ArgusAgent (debug & logger coverage)", () => {
  let agent: ArgusAgent | null = null;

  afterEach(async () => {
    if (agent) {
      agent.stop();
      agent = null;
    }
    delete process.env.ARGUS_DEBUG;
  });

  it("ARGUS_DEBUG=true should activate console logger and not throw", async () => {
    process.env.ARGUS_DEBUG = "true";
    agent = await ArgusAgent.create()
      .withInstrumentation()
      .withHttpTracing()
      .withCrashGuard()
      .withLogTracing()
      .start();

    assert.ok(agent.isRunning);

    // Emit events to trigger the console logger paths
    agent.emit("anomaly", { type: "event-loop-lag", lagMs: 100, timestamp: Date.now() });
    agent.emit("leak", { handlesCount: 5 });
    agent.emit("crash", { error: new Error("test crash") });
    agent.emit("error", new Error("test error"));
    agent.emit("info", "test info message");
    agent.emit("log", { scrubbed: true, level: "warn", durationMs: 1 });
    agent.emit("log", { scrubbed: false, level: "info", durationMs: 0 });
    agent.emit("query", {
      sanitizedQuery: "SELECT ?",
      durationMs: 1.5,
      suggestions: [{ message: "hint" }],
    });
    agent.emit("query", { sanitizedQuery: "SELECT ?", durationMs: 0.5 });
    agent.emit("http", { method: "GET", url: "/api", statusCode: 200, durationMs: 10.2 });
    agent.emit("http", { method: "POST", url: "/api", statusCode: undefined, durationMs: 5.0 });
  });

  it("crash event with no error.message should use the event itself", async () => {
    process.env.ARGUS_DEBUG = "true";
    agent = await ArgusAgent.create().withCrashGuard().start();

    // Emit crash with no error object
    agent.emit("crash", "raw crash string");
    // Emit error with no message
    agent.emit("error", "raw error string");
  });

  it("start() should be idempotent — second call is a no-op", async () => {
    agent = await ArgusAgent.create().withCrashGuard().start();
    const first = agent.isRunning;
    await agent.start(); // second call
    assert.strictEqual(agent.isRunning, first);
  });
});
