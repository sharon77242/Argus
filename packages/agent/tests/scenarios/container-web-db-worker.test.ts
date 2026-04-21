/**
 * Scenario: Containerized Web + DB + Worker Node.js App
 *
 * Simulates what happens when ArgusAgent is deployed inside a production
 * Docker container running a typical Express-style web API, a PostgreSQL-backed
 * query layer, and a background job processor.
 *
 * Validation targets:
 *  - Agent boots cleanly under the 'web+db+worker' mixed profile
 *  - All expected events fire (query, http, log, crash, leak)
 *  - SQL sanitization strips sensitive literals before they leave the process
 *  - Zero-overhead kill-switch via env var works end-to-end
 *  - Agent survives start → traffic → graceful stop without leaking timers
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import diagnostics_channel from "node:diagnostics_channel";
import { ArgusAgent } from "../../src/argus-agent.ts";
import type { TracedQuery } from "../../src/instrumentation/engine.ts";
import type { TracedLog } from "../../src/instrumentation/logger.ts";
import type { TracedHttpRequest } from "../../src/instrumentation/http.ts";
import type { CrashEvent } from "../../src/profiling/crash-guard.ts";
import type { ResourceLeakEvent } from "../../src/profiling/resource-leak-monitor.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Publish a fake DB query via diagnostics_channel (mimics pg / mysql2 drivers). */
function publishFakeQuery(sql: string, durationMs = 5): void {
  const ch = diagnostics_channel.channel("db.query.execution");
  if (ch.hasSubscribers) {
    ch.publish({ query: sql, durationMs });
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Scenario: Containerized Web + DB + Worker", () => {
  // ── 1. Boot & Lifecycle ───────────────────────────────────────────────────

  describe("1. Lifecycle — start, run, stop", () => {
    it("boots with a full web+db+worker mixed profile and stops cleanly", async () => {
      const agent = ArgusAgent.createProfile({
        environment: "prod",
        appType: ["web", "db", "worker"],
      });

      await agent.start();
      assert.ok(agent.isRunning, "agent should be running after start()");

      // Simulate a brief container "running" window
      await wait(20);

      agent.stop();
      assert.ok(!agent.isRunning, "agent should not be running after stop()");
    });

    it("start() is idempotent — calling twice does not throw", async () => {
      const agent = ArgusAgent.create()
        .withInstrumentation()
        .withResourceLeakMonitor({ intervalMs: 60_000 });

      await agent.start();
      await agent.start(); // second call should be a no-op
      assert.ok(agent.isRunning);
      agent.stop();
    });

    it("stop() is idempotent — calling twice does not throw", async () => {
      const agent = ArgusAgent.create().withCrashGuard();
      await agent.start();
      agent.stop();
      agent.stop(); // should be safe
      assert.ok(!agent.isRunning);
    });
  });

  // ── 2. Zero-Overhead Kill-Switch ──────────────────────────────────────────

  describe("2. Kill-switch — env var DIAGNOSTIC_AGENT_ENABLED=false", () => {
    beforeEach(() => {
      delete process.env.DIAGNOSTIC_AGENT_ENABLED;
    });

    after(() => {
      delete process.env.DIAGNOSTIC_AGENT_ENABLED;
    });

    it('is globally disabled when env var is "false"', async () => {
      process.env.DIAGNOSTIC_AGENT_ENABLED = "false";

      const agent = ArgusAgent.createProfile({
        environment: "prod",
        appType: ["web", "db", "worker"],
      });

      // Calling chain methods on a disabled agent must not throw
      agent.withHttpTracing().withQueryAnalysis().withCrashGuard();

      // start() must silently skip everything
      await agent.start();
      assert.ok(!agent.isRunning, "disabled agent should never enter running state");
      agent.stop();
    });

    it('is globally disabled when env var is "0"', async () => {
      process.env.DIAGNOSTIC_AGENT_ENABLED = "0";

      const agent = ArgusAgent.createProfile({ environment: "prod", appType: "web" });
      await agent.start();
      assert.ok(!agent.isRunning);
      agent.stop();
    });

    it('is active when env var is "1"', async () => {
      process.env.DIAGNOSTIC_AGENT_ENABLED = "1";

      const agent = ArgusAgent.createProfile({ environment: "prod", appType: "web" });
      await agent.start();
      assert.ok(agent.isRunning);
      agent.stop();
    });
  });

  // ── 3. Query Tracing & SQL Sanitization ──────────────────────────────────

  describe("3. DB layer — query tracing + SQL sanitization", () => {
    it("captures and sanitizes a diagnostics_channel query event", async () => {
      const captured: TracedQuery[] = [];

      const agent = ArgusAgent.create()
        .withInstrumentation({ autoPatching: false })
        .withQueryAnalysis();

      agent.on("query", (q) => captured.push(q));

      await agent.start();

      publishFakeQuery("SELECT * FROM users WHERE id = 42 AND token = 'abc123'", 12);

      // Give the channel microtask a tick to propagate
      await wait(10);

      agent.stop();

      assert.ok(captured.length > 0, "at least one query event expected");
      const q = captured[0];
      assert.ok(typeof q.sanitizedQuery === "string", "sanitizedQuery must be a string");
      // Sensitive literal '42' and 'abc123' must not survive sanitization
      assert.ok(!q.sanitizedQuery.includes("42"), `literal 42 leaked: ${q.sanitizedQuery}`);
      assert.ok(!q.sanitizedQuery.includes("abc123"), `token leaked: ${q.sanitizedQuery}`);
    });

    it("traceQuery() wraps arbitrary async execution and emits an event", async () => {
      const captured: TracedQuery[] = [];

      const agent = ArgusAgent.create().withInstrumentation();
      agent.on("query", (q) => captured.push(q));
      await agent.start();

      const result = await agent.traceQuery(
        'SELECT name FROM orders WHERE status = "pending"',
        async () => {
          await wait(5);
          return [{ name: "Order #1" }];
        },
      );

      agent.stop();

      assert.deepStrictEqual(result, [{ name: "Order #1" }]);
      assert.ok(captured.length === 1, "exactly one query event");
      assert.ok(captured[0].durationMs >= 1, "duration should reflect actual wait");
    });

    it("traceQuery() still emits on failure", async () => {
      const captured: TracedQuery[] = [];

      const agent = ArgusAgent.create().withInstrumentation();
      agent.on("query", (q) => captured.push(q));
      await agent.start();

      await assert.rejects(
        () =>
          agent.traceQuery("DELETE FROM sessions WHERE expired = 1", async () => {
            throw new Error("DB connection refused");
          }),
        /DB connection refused/,
      );

      agent.stop();

      assert.ok(captured.length === 1);
      assert.ok(captured[0].sanitizedQuery.includes("[FAILED]"));
    });
  });

  // ── 4. Log Scrubbing ──────────────────────────────────────────────────────

  describe("4. Logger — secret scrubbing via log tracing", () => {
    it("scrubs high-entropy secrets from console output", async () => {
      const logEvents: TracedLog[] = [];

      const agent = ArgusAgent.create().withLogTracing({ entropyThreshold: 3.5 });
      agent.on("log", (l) => logEvents.push(l));
      await agent.start();

      // A JWT-like secret with high Shannon entropy
      const secret = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret.part";
      console.log(`User authenticated with token: ${secret}`);

      await wait(10);
      agent.stop();

      assert.ok(logEvents.length > 0, "log event must be captured");
      assert.ok(logEvents[0].scrubbed, "secret should have been scrubbed from the log");
    });
  });

  // ── 5. HTTP Tracing ───────────────────────────────────────────────────────

  describe("5. HTTP layer — outgoing request tracing", () => {
    it("agent starts with HTTP tracing enabled without errors", async () => {
      const httpEvents: TracedHttpRequest[] = [];

      const agent = ArgusAgent.create().withHttpTracing().withInstrumentation();

      agent.on("http", (r) => httpEvents.push(r));
      await agent.start();

      // We just verify init is error-free; actual HTTP interception
      // requires live sockets which are out-of-scope for this unit.
      assert.ok(agent.isRunning);
      agent.stop();
    });
  });

  // ── 6. Crash Guard ────────────────────────────────────────────────────────

  describe("6. Crash Guard — uncaught exception telemetry", () => {
    it("crash guard enables and disables cleanly", async () => {
      const crashEvents: CrashEvent[] = [];

      const agent = ArgusAgent.create().withCrashGuard();
      agent.on("crash", (e) => crashEvents.push(e));

      await agent.start();
      assert.ok(agent.isRunning);
      agent.stop();

      // We do NOT trigger an actual uncaught exception in tests — that would
      // kill the process. We verify the guard mounted/unmounted without error.
      assert.strictEqual(crashEvents.length, 0);
    });
  });

  // ── 7. Resource Leak Monitor ──────────────────────────────────────────────

  describe("7. Resource Leak Monitor — handle exhaustion detection", () => {
    it("starts and stops the leak monitor without error", async () => {
      const leakEvents: ResourceLeakEvent[] = [];

      const agent = ArgusAgent.create().withResourceLeakMonitor({
        handleThreshold: 1, // Deliberately low so it could fire
        intervalMs: 50,
        alertCooldownMs: 0,
      });

      agent.on("leak", (e) => leakEvents.push(e));

      await agent.start();
      await wait(100); // Allow at least one check interval
      agent.stop();

      // If process.getActiveResourcesInfo is available and handles > 1,
      // at least one leak event should have fired.
      if (typeof process.getActiveResourcesInfo === "function") {
        const handles = process.getActiveResourcesInfo().length;
        if (handles > 1) {
          assert.ok(leakEvents.length > 0, "leak event expected when handles exceed threshold");
          assert.ok(typeof leakEvents[0].handlesCount === "number");
        }
      }
      // On older Node or zero handles — just verify no crash
    });
  });

  // ── 8. Full "Container Boot" Scenario ─────────────────────────────────────

  describe("8. Full container boot — end-to-end smoke test", () => {
    let agent: ArgusAgent;
    const events: Record<string, any[]> = {
      query: [],
      log: [],
      anomaly: [],
      error: [],
    };

    before(async () => {
      agent = ArgusAgent.createProfile({
        environment: "prod",
        appType: ["web", "db", "worker"],
      });

      for (const key of Object.keys(events)) {
        agent.on(key, (e: any) => events[key].push(e));
      }

      await agent.start();
    });

    after(() => {
      agent.stop();
    });

    it("agent is running after boot", () => {
      assert.ok(agent.isRunning);
    });

    it("handles a burst of simulated DB queries", async () => {
      const queries = [
        "SELECT id, email FROM accounts WHERE plan = 'enterprise'",
        "UPDATE sessions SET last_seen = NOW() WHERE user_id = 99",
        "INSERT INTO events (type, data) VALUES ('login', '{\"ip\":\"1.2.3.4\"}')",
        "SELECT COUNT(*) FROM jobs WHERE status = 'pending' AND retries < 3",
      ];

      for (const sql of queries) {
        publishFakeQuery(sql, Math.random() * 20 + 2);
      }

      await wait(30);

      assert.ok(
        events.query.length === queries.length,
        `Expected ${queries.length} query events, got ${events.query.length}`,
      );

      // Privacy check: no raw literals should survive
      for (const q of events.query) {
        assert.ok(typeof q.sanitizedQuery === "string");
        assert.ok(!q.sanitizedQuery.includes("enterprise"), `plan literal leaked`);
        assert.ok(!q.sanitizedQuery.includes("99"), `user_id literal leaked`);
        assert.ok(!q.sanitizedQuery.includes("1.2.3.4"), `IP leaked`);
      }
    });

    it("no errors were emitted during the scenario", () => {
      assert.strictEqual(
        events.error.length,
        0,
        `Unexpected errors: ${JSON.stringify(events.error)}`,
      );
    });
  });
});
