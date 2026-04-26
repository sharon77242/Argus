import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ArgusAgent } from "../../src/argus-agent.ts";

interface AnomalyEvent {
  type: string;
  url?: string;
  method?: string;
  durationMs?: number;
  traceId?: string;
  correlationId?: string;
  driver?: string;
  waitingCount?: number;
  culprits?: { sanitizedQuery: string; durationMs: number }[];
  suggestions?: { rule: string; severity: string; message: string }[];
}

function makeAgent(): ArgusAgent {
  return ArgusAgent.create();
}

describe("Cross-signal rules (R.3, R.4, R.5)", () => {
  let agent: ArgusAgent | null = null;

  afterEach(async () => {
    await agent?.stop();
    agent = null;
  });

  // ── R.3 correlated-slow-endpoint ─────────────────────────────────────────

  describe("R.3 correlated-slow-endpoint", () => {
    it("fires when slow HTTP and N+1 share the same traceId", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("query", {
        sanitizedQuery: "SELECT ? FROM users WHERE id = ?",
        durationMs: 5,
        traceId: "trace-abc",
        suggestions: [{ rule: "n-plus-one", severity: "warning", message: "N+1 detected" }],
      });

      agent.emit("http", {
        method: "GET",
        url: "/api/users",
        durationMs: 2000,
        traceId: "trace-abc",
      });

      const rule = anomalies.find((e) => e.type === "correlated-slow-endpoint");
      assert.ok(rule, "correlated-slow-endpoint should fire");
      assert.ok(
        rule.suggestions?.some((s) => s.rule === "correlated-slow-endpoint"),
        "suggestion with rule correlated-slow-endpoint expected",
      );
      assert.strictEqual(rule.suggestions?.[0].severity, "critical");
    });

    it("does NOT fire when slow HTTP has no N+1 on the same traceId", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("http", {
        method: "GET",
        url: "/api/users",
        durationMs: 2000,
        traceId: "trace-no-n1",
      });

      assert.ok(!anomalies.find((e) => e.type === "correlated-slow-endpoint"));
    });

    it("does NOT fire when N+1 is on a different traceId than the slow HTTP", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("query", {
        sanitizedQuery: "SELECT ? FROM orders WHERE id = ?",
        durationMs: 5,
        traceId: "trace-other",
        suggestions: [{ rule: "n-plus-one", severity: "warning", message: "N+1" }],
      });

      agent.emit("http", {
        method: "GET",
        url: "/api/products",
        durationMs: 2000,
        traceId: "trace-different",
      });

      assert.ok(!anomalies.find((e) => e.type === "correlated-slow-endpoint"));
    });

    it("does NOT fire when HTTP duration is below threshold", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("query", {
        sanitizedQuery: "SELECT ? FROM users WHERE id = ?",
        durationMs: 5,
        traceId: "trace-fast",
        suggestions: [{ rule: "n-plus-one", severity: "warning", message: "N+1" }],
      });

      agent.emit("http", {
        method: "GET",
        url: "/api/users",
        durationMs: 200,
        traceId: "trace-fast",
      });

      assert.ok(!anomalies.find((e) => e.type === "correlated-slow-endpoint"));
    });

    it("does NOT fire when HTTP event has no traceId", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("query", {
        sanitizedQuery: "SELECT ? FROM users",
        durationMs: 5,
        traceId: "trace-x",
        suggestions: [{ rule: "n-plus-one", severity: "warning", message: "N+1" }],
      });

      agent.emit("http", {
        method: "GET",
        url: "/api/users",
        durationMs: 2000,
      });

      assert.ok(!anomalies.find((e) => e.type === "correlated-slow-endpoint"));
    });
  });

  // ── R.4 pool-starvation-by-slow-query ────────────────────────────────────

  describe("R.4 pool-starvation-by-slow-query", () => {
    it("fires when pool exhaustion follows a recent slow query on the same driver", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("slow-query", {
        sanitizedQuery: "SELECT ? FROM reports WHERE account_id = ?",
        durationMs: 8000,
        driver: "pg",
        timestamp: Date.now(),
      });

      agent.emit("pool-exhaustion", {
        driver: "pg",
        waitingCount: 5,
        totalCount: 10,
        idleCount: 0,
        timestamp: Date.now(),
      });

      const rule = anomalies.find((e) => e.type === "pool-starvation-by-slow-query");
      assert.ok(rule, "pool-starvation-by-slow-query should fire");
      assert.ok(rule.suggestions?.some((s) => s.rule === "pool-starvation-by-slow-query"));
      assert.strictEqual(rule.suggestions?.[0].severity, "critical");
    });

    it("does NOT fire when no recent slow queries preceded the pool exhaustion", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("pool-exhaustion", {
        driver: "pg",
        waitingCount: 5,
        totalCount: 10,
        idleCount: 0,
        timestamp: Date.now(),
      });

      assert.ok(!anomalies.find((e) => e.type === "pool-starvation-by-slow-query"));
    });

    it("includes the slow query in the culprits list", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("slow-query", {
        sanitizedQuery: "SELECT ? FROM heavy_table",
        durationMs: 5000,
        driver: "pg",
        timestamp: Date.now(),
      });

      agent.emit("pool-exhaustion", {
        driver: "pg",
        waitingCount: 3,
        totalCount: 5,
        idleCount: 0,
        timestamp: Date.now(),
      });

      const rule = anomalies.find((e) => e.type === "pool-starvation-by-slow-query");
      assert.ok(rule?.culprits?.length, "culprits should be populated");
      assert.ok(rule!.culprits!.some((c) => c.sanitizedQuery === "SELECT ? FROM heavy_table"));
    });
  });

  // ── R.5 n-plus-one-in-transaction ────────────────────────────────────────

  describe("R.5 n-plus-one-in-transaction", () => {
    it("fires when N+1 is detected inside an open transaction on the same traceId", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("query", {
        sanitizedQuery: "BEGIN",
        durationMs: 1,
        traceId: "txn-trace-1",
        suggestions: [],
      });

      agent.emit("query", {
        sanitizedQuery: "SELECT ? FROM users WHERE id = ?",
        durationMs: 5,
        traceId: "txn-trace-1",
        suggestions: [{ rule: "n-plus-one", severity: "warning", message: "N+1" }],
      });

      const rule = anomalies.find((e) => e.type === "n-plus-one-in-transaction");
      assert.ok(rule, "n-plus-one-in-transaction should fire");
      assert.strictEqual(rule.suggestions?.[0].severity, "critical");
    });

    it("does NOT fire when N+1 is detected outside any open transaction", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("query", {
        sanitizedQuery: "SELECT ? FROM users WHERE id = ?",
        durationMs: 5,
        traceId: "no-txn-trace",
        suggestions: [{ rule: "n-plus-one", severity: "warning", message: "N+1" }],
      });

      assert.ok(!anomalies.find((e) => e.type === "n-plus-one-in-transaction"));
    });

    it("does NOT fire when N+1 is on a different traceId than the open transaction", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("query", {
        sanitizedQuery: "BEGIN",
        durationMs: 1,
        traceId: "txn-trace-A",
        suggestions: [],
      });

      agent.emit("query", {
        sanitizedQuery: "SELECT ? FROM orders WHERE id = ?",
        durationMs: 5,
        traceId: "txn-trace-B",
        suggestions: [{ rule: "n-plus-one", severity: "warning", message: "N+1" }],
      });

      assert.ok(!anomalies.find((e) => e.type === "n-plus-one-in-transaction"));
    });

    it("COMMIT closes the transaction — N+1 after COMMIT does NOT fire", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("query", {
        sanitizedQuery: "BEGIN",
        durationMs: 1,
        traceId: "txn-close",
        suggestions: [],
      });
      agent.emit("query", {
        sanitizedQuery: "COMMIT",
        durationMs: 1,
        traceId: "txn-close",
        suggestions: [],
      });

      agent.emit("query", {
        sanitizedQuery: "SELECT ? FROM users WHERE id = ?",
        durationMs: 5,
        traceId: "txn-close",
        suggestions: [{ rule: "n-plus-one", severity: "warning", message: "N+1" }],
      });

      assert.ok(!anomalies.find((e) => e.type === "n-plus-one-in-transaction"));
    });

    it("falls back to correlationId when traceId is absent", async () => {
      agent = await makeAgent().start();

      const anomalies: AnomalyEvent[] = [];
      agent.on("anomaly", (e: AnomalyEvent) => anomalies.push(e));

      agent.emit("query", {
        sanitizedQuery: "BEGIN",
        durationMs: 1,
        correlationId: "corr-1",
        suggestions: [],
      });

      agent.emit("query", {
        sanitizedQuery: "SELECT ? FROM users WHERE id = ?",
        durationMs: 5,
        correlationId: "corr-1",
        suggestions: [{ rule: "n-plus-one", severity: "warning", message: "N+1" }],
      });

      const rule = anomalies.find((e) => e.type === "n-plus-one-in-transaction");
      assert.ok(rule, "should fire when using correlationId");
    });
  });
});
