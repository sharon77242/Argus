import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { GracefulShutdown } from "../../src/profiling/graceful-shutdown.ts";
import type { ArgusAgent } from "../../src/argus-agent.ts";

// Minimal ArgusAgent stub for testing
function makeAgentStub() {
  const agent = new EventEmitter() as EventEmitter & {
    stop: () => Promise<void>;
    stopCallCount: number;
  };
  agent.stopCallCount = 0;
  agent.stop = async () => {
    agent.stopCallCount++;
  };
  return agent as unknown as ArgusAgent & { stopCallCount: number };
}

function makeHangingAgentStub() {
  const agent = new EventEmitter() as EventEmitter & { stop: () => Promise<void> };
  agent.stop = () => new Promise<void>(() => {}); // never resolves
  return agent as unknown as ArgusAgent;
}

// Intercepts process.exit for the duration of fn(), restores it after.
async function withExitMock(fn: (exitCodes: number[]) => Promise<void>): Promise<void> {
  const exitCodes: number[] = [];
  const original = process.exit.bind(process);
  process.exit = ((code?: number) => {
    exitCodes.push(code ?? 0);
  }) as typeof process.exit;
  try {
    await fn(exitCodes);
  } finally {
    process.exit = original;
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  }
}

describe("GracefulShutdown", () => {
  test("registers SIGTERM and SIGINT handlers", () => {
    const agent = makeAgentStub();
    const gs = new GracefulShutdown();

    const sigterm0 = process.listenerCount("SIGTERM");
    const sigint0 = process.listenerCount("SIGINT");

    gs.register(agent);

    assert.equal(
      process.listenerCount("SIGTERM"),
      sigterm0 + 1,
      "SIGTERM listener should be added",
    );
    assert.equal(process.listenerCount("SIGINT"), sigint0 + 1, "SIGINT listener should be added");

    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });

  test("calling register() twice is idempotent (no duplicate handlers)", () => {
    const agent = makeAgentStub();
    const gs = new GracefulShutdown();

    const sigterm0 = process.listenerCount("SIGTERM");
    const sigint0 = process.listenerCount("SIGINT");

    gs.register(agent);
    gs.register(agent); // second call is no-op

    assert.equal(
      process.listenerCount("SIGTERM"),
      sigterm0 + 1,
      "Only one SIGTERM handler should be registered",
    );
    assert.equal(
      process.listenerCount("SIGINT"),
      sigint0 + 1,
      "Only one SIGINT handler should be registered",
    );

    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });

  test("SIGTERM: emits info message, calls stop(), exits 0 on happy path", async () => {
    await withExitMock(async (exitCodes) => {
      const agent = makeAgentStub();
      const messages: string[] = [];
      (agent as unknown as EventEmitter).on("info", (m: string) => messages.push(m));

      const gs = new GracefulShutdown();
      gs.register(agent, { timeoutMs: 200 });

      process.emit("SIGTERM");
      await new Promise<void>((r) => setTimeout(r, 60));

      assert.ok(
        messages.some((m) => m.includes("SIGTERM")),
        "Should emit info about SIGTERM",
      );
      assert.equal(agent.stopCallCount, 1, "agent.stop() should be called once");
      assert.deepEqual(exitCodes, [0], "Should exit with code 0 on clean flush");
    });
  });

  test("SIGINT: emits info message, calls stop(), exits 0 on happy path", async () => {
    await withExitMock(async (exitCodes) => {
      const agent = makeAgentStub();
      const messages: string[] = [];
      (agent as unknown as EventEmitter).on("info", (m: string) => messages.push(m));

      const gs = new GracefulShutdown();
      gs.register(agent, { timeoutMs: 200 });

      process.emit("SIGINT");
      await new Promise<void>((r) => setTimeout(r, 60));

      assert.ok(
        messages.some((m) => m.includes("SIGINT")),
        "Should emit info about SIGINT",
      );
      assert.equal(agent.stopCallCount, 1, "agent.stop() should be called once");
      assert.deepEqual(exitCodes, [0], "Should exit with code 0 on clean flush");
    });
  });

  test("timeout fires with exit code 1 when agent.stop() hangs", async () => {
    await withExitMock(async (exitCodes) => {
      const agent = makeHangingAgentStub();

      const gs = new GracefulShutdown();
      gs.register(agent, { timeoutMs: 40 });

      process.emit("SIGTERM");
      await new Promise<void>((r) => setTimeout(r, 120));

      assert.ok(exitCodes.length >= 1, "process.exit should have been called by the timeout");
      assert.equal(exitCodes[0], 1, "Timeout path should exit with code 1 (degraded shutdown)");
    });
  });

  test("no double-exit race: process.exit called exactly once when stop() resolves before timeout", async () => {
    await withExitMock(async (exitCodes) => {
      const agent = makeAgentStub();

      const gs = new GracefulShutdown();
      gs.register(agent, { timeoutMs: 500 });

      process.emit("SIGTERM");
      // Wait well past stop() resolution but before the 500ms timeout
      await new Promise<void>((r) => setTimeout(r, 60));

      assert.equal(exitCodes.length, 1, "process.exit should be called exactly once");
      assert.equal(exitCodes[0], 0, "Should exit 0 when stop() resolved first");
    });
  });

  test("listener throwing on info event does not prevent shutdown", async () => {
    await withExitMock(async (exitCodes) => {
      const agent = makeAgentStub();
      (agent as unknown as EventEmitter).on("info", () => {
        throw new Error("bad listener");
      });

      const gs = new GracefulShutdown();
      gs.register(agent, { timeoutMs: 200 });

      process.emit("SIGTERM");
      await new Promise<void>((r) => setTimeout(r, 60));

      // Shutdown must complete despite the throwing listener
      assert.ok(exitCodes.length >= 1, "Should still exit even when info listener throws");
    });
  });

  test("timeoutMs: 0 fires timeout immediately", async () => {
    await withExitMock(async (exitCodes) => {
      const agent = makeHangingAgentStub();

      const gs = new GracefulShutdown();
      gs.register(agent, { timeoutMs: 0 });

      process.emit("SIGTERM");
      await new Promise<void>((r) => setTimeout(r, 40));

      assert.ok(exitCodes.length >= 1, "Timeout should fire immediately with timeoutMs: 0");
      assert.equal(exitCodes[0], 1, "Immediate timeout should still exit 1");
    });
  });

  test("fresh instance starts with registered = false", () => {
    const gs = new GracefulShutdown();
    // Private field — check indirectly: registering twice on a fresh instance
    // adds exactly one handler, not zero (i.e. registered starts false)
    const agent = makeAgentStub();
    const before = process.listenerCount("SIGTERM");
    gs.register(agent);
    assert.equal(process.listenerCount("SIGTERM"), before + 1);
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });
});
