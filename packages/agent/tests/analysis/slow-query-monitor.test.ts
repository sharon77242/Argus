import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SlowQueryMonitor, DRIVER_DEFAULTS } from "../../src/analysis/slow-query-monitor.ts";

interface RecordArgs {
  sanitizedQuery?: string;
  durationMs?: number;
  driver?: string;
  timestamp?: number;
  sourceLine?: string;
  correlationId?: string;
}

function makeRecord(overrides: RecordArgs = {}) {
  return {
    sanitizedQuery: overrides.sanitizedQuery ?? "SELECT ? FROM users",
    durationMs: overrides.durationMs ?? 1500,
    driver: overrides.driver ?? "pg",
    timestamp: overrides.timestamp ?? Date.now(),
    sourceLine: overrides.sourceLine,
    correlationId: overrides.correlationId,
  };
}

describe("SlowQueryMonitor", () => {
  let monitor: SlowQueryMonitor;

  beforeEach(() => {
    monitor = new SlowQueryMonitor({ defaultThresholdMs: 1000 });
  });

  it("flags a query that exceeds the built-in driver default (pg: 500ms)", () => {
    // pg has DRIVER_DEFAULT of 500ms — takes priority over defaultThresholdMs: 1000
    const r = makeRecord({ durationMs: 600, driver: "pg" });
    const result = monitor.check(r.sanitizedQuery, r.durationMs, r.driver, r.timestamp);
    assert.ok(result !== null, "Should flag slow query");
    assert.strictEqual(result.durationMs, 600);
    assert.strictEqual(result.thresholdMs, 500);
  });

  it("flags a query that exceeds the global fallback for unknown drivers", () => {
    // 'custom-driver' has no DRIVER_DEFAULT → falls through to defaultThresholdMs: 1000
    const r = makeRecord({ durationMs: 1500, driver: "custom-driver" });
    const result = monitor.check(r.sanitizedQuery, r.durationMs, r.driver, r.timestamp);
    assert.ok(result !== null, "Should flag slow query");
    assert.strictEqual(result.thresholdMs, 1000);
  });

  it("does not flag a query below its driver default threshold", () => {
    // pg default is 500ms; a 100ms query should not be flagged
    const r = makeRecord({ durationMs: 100, driver: "pg" });
    const result = monitor.check(r.sanitizedQuery, r.durationMs, r.driver, r.timestamp);
    assert.strictEqual(result, null, "Should not flag fast query");
  });

  it("uses per-driver threshold when set", () => {
    monitor = new SlowQueryMonitor({ defaultThresholdMs: 1000, thresholds: { redis: 50 } });

    // Redis: 60ms > 50ms threshold → slow
    const slow = monitor.check("GET ?", 60, "redis", Date.now());
    assert.ok(slow !== null, "Redis 60ms should exceed 50ms threshold");
    assert.strictEqual(slow.thresholdMs, 50);

    // pg: 60ms < 1000ms default → fast
    const fast = monitor.check("SELECT ? FROM t", 60, "pg", Date.now());
    assert.strictEqual(fast, null, "pg 60ms should not exceed 1000ms threshold");
  });

  it("getThreshold returns per-driver override over built-in default", () => {
    monitor = new SlowQueryMonitor({
      defaultThresholdMs: 1000,
      thresholds: { pg: 200, redis: 25 },
    });
    assert.strictEqual(monitor.getThreshold("pg"), 200); // options override DRIVER_DEFAULTS
    assert.strictEqual(monitor.getThreshold("redis"), 25); // options override DRIVER_DEFAULTS
    assert.strictEqual(monitor.getThreshold("mongodb"), DRIVER_DEFAULTS.mongodb); // built-in
    assert.strictEqual(monitor.getThreshold("custom"), 1000); // no DRIVER_DEFAULT → global fallback
  });

  it("getThreshold uses DRIVER_DEFAULTS when no option or env var is set", () => {
    monitor = new SlowQueryMonitor({ defaultThresholdMs: 9999 });
    assert.strictEqual(monitor.getThreshold("pg"), 500);
    assert.strictEqual(monitor.getThreshold("redis"), 50);
    assert.strictEqual(monitor.getThreshold("ioredis"), 50);
    assert.strictEqual(monitor.getThreshold("better-sqlite3"), 100);
    assert.strictEqual(monitor.getThreshold("mongodb"), 500);
    assert.strictEqual(monitor.getThreshold("@aws-sdk/client-dynamodb"), 200);
    assert.strictEqual(monitor.getThreshold("@clickhouse/client"), 5000);
    assert.strictEqual(monitor.getThreshold("@google-cloud/bigquery"), 10000);
    assert.strictEqual(monitor.getThreshold("unknown-driver"), 9999); // global fallback
  });

  it("keeps only the top-N slowest queries", () => {
    monitor = new SlowQueryMonitor({ defaultThresholdMs: 0, topN: 3 });
    // use 'custom-db' which has no DRIVER_DEFAULT, so threshold=0 catches everything
    monitor.check("Q1", 100, "custom-db", Date.now());
    monitor.check("Q2", 500, "custom-db", Date.now());
    monitor.check("Q3", 200, "custom-db", Date.now());
    monitor.check("Q4", 50, "custom-db", Date.now());
    monitor.check("Q5", 800, "custom-db", Date.now());

    const slow = monitor.getSlowQueries();
    assert.strictEqual(slow.length, 3);
    assert.strictEqual(slow[0].durationMs, 800);
    assert.strictEqual(slow[1].durationMs, 500);
    assert.strictEqual(slow[2].durationMs, 200);
  });

  it("getSlowest returns the single slowest query", () => {
    monitor = new SlowQueryMonitor({ defaultThresholdMs: 0, topN: 5 });
    monitor.check("A", 300, "pg", Date.now());
    monitor.check("B", 900, "pg", Date.now());
    monitor.check("C", 100, "pg", Date.now());

    const s = monitor.getSlowest();
    assert.ok(s !== undefined);
    assert.strictEqual(s.durationMs, 900);
    assert.strictEqual(s.sanitizedQuery, "B");
  });

  it("getSlowest returns undefined when no queries recorded", () => {
    assert.strictEqual(monitor.getSlowest(), undefined);
  });

  it("clear() empties the log", () => {
    monitor = new SlowQueryMonitor({ defaultThresholdMs: 0 });
    monitor.check("Q", 500, "pg", Date.now());
    assert.strictEqual(monitor.getSlowQueries().length, 1);
    monitor.clear();
    assert.strictEqual(monitor.getSlowQueries().length, 0);
    assert.strictEqual(monitor.getSlowest(), undefined);
  });

  it("getSlowQueries returns a copy (mutations do not affect internal state)", () => {
    monitor = new SlowQueryMonitor({ defaultThresholdMs: 0 });
    monitor.check("Q", 500, "pg", Date.now());
    const copy = monitor.getSlowQueries();
    copy.length = 0;
    assert.strictEqual(monitor.getSlowQueries().length, 1);
  });

  it("records driver, sourceLine, and correlationId on the record", () => {
    monitor = new SlowQueryMonitor({ defaultThresholdMs: 0 });
    const result = monitor.check("SELECT ?", 200, "custom-db", Date.now(), "app.ts:42", "req-123");
    assert.ok(result !== null);
    assert.strictEqual(result.driver, "custom-db");
    assert.strictEqual(result.sourceLine, "app.ts:42");
    assert.strictEqual(result.correlationId, "req-123");
  });

  describe("missing-driver warning", () => {
    let originalNodeEnv: string | undefined;
    // Counts only warnings for the driver name set in each test — prevents
    // cross-contamination from other suite tests that also use custom drivers.
    let trackedDriver = "";
    let warningCodes: string[] = [];

    function onWarning(warning: Error & { code?: string; message?: string }): void {
      if (
        warning.code === "ARGUS_MISSING_DRIVER_THRESHOLD" &&
        trackedDriver &&
        warning.message.includes(`"${trackedDriver}"`)
      ) {
        warningCodes.push(warning.code);
      }
    }

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
      warningCodes = [];
      trackedDriver = "";
      // process.on('warning') is additive and parallel-safe — unlike
      // monkey-patching process.emitWarning which mutates a global.
      process.on("warning", onWarning);
    });

    afterEach(() => {
      process.off("warning", onWarning);
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    });

    it("emits process warning once for an unregistered driver in non-production", async () => {
      process.env.NODE_ENV = "development";
      trackedDriver = "argus-test-unique-driver-abc";
      const m = new SlowQueryMonitor({ defaultThresholdMs: 1000 });
      m.getThreshold(trackedDriver);
      m.getThreshold(trackedDriver); // second call must not re-warn
      // Warning events are emitted asynchronously via nextTick — yield one tick.
      await new Promise<void>((r) => process.nextTick(r));
      assert.strictEqual(warningCodes.length, 1, "should warn exactly once per unknown driver");
    });

    it("does not emit warning when NODE_ENV is production", async () => {
      process.env.NODE_ENV = "production";
      trackedDriver = "argus-test-unique-driver-abc";
      const m = new SlowQueryMonitor({ defaultThresholdMs: 1000 });
      m.getThreshold(trackedDriver);
      await new Promise<void>((r) => process.nextTick(r));
      assert.strictEqual(warningCodes.length, 0, "should not warn in production");
    });

    it("does not emit warning for drivers in DRIVER_DEFAULTS", async () => {
      process.env.NODE_ENV = "development";
      trackedDriver = "pg"; // Known driver — should never trigger the warning
      const m = new SlowQueryMonitor({ defaultThresholdMs: 1000 });
      m.getThreshold("pg");
      m.getThreshold("redis");
      await new Promise<void>((r) => process.nextTick(r));
      assert.strictEqual(warningCodes.length, 0, "known drivers must not trigger warning");
    });
  });

  describe("env var overrides", () => {
    afterEach(() => {
      delete process.env.ARGUS_SLOW_QUERY_THRESHOLD_MS;
      delete process.env.ARGUS_SLOW_QUERY_THRESHOLD_PG;
      delete process.env.ARGUS_SLOW_QUERY_THRESHOLD_ELASTIC_ELASTICSEARCH;
    });

    it("ARGUS_SLOW_QUERY_THRESHOLD_MS overrides defaultThresholdMs for unknown drivers", () => {
      process.env.ARGUS_SLOW_QUERY_THRESHOLD_MS = "200";
      const m = new SlowQueryMonitor({ defaultThresholdMs: 1000 });
      // 'unknown-driver' has no DRIVER_DEFAULT → falls through to env-based global default
      assert.strictEqual(m.getThreshold("unknown-driver"), 200);
      // 'pg' has DRIVER_DEFAULT=500 which takes priority over the global env var
      assert.strictEqual(m.getThreshold("pg"), 500);
    });

    it("ARGUS_SLOW_QUERY_THRESHOLD_<DRIVER> overrides per-driver options", () => {
      process.env.ARGUS_SLOW_QUERY_THRESHOLD_PG = "300";
      const m = new SlowQueryMonitor({ defaultThresholdMs: 1000, thresholds: { pg: 500 } });
      // env var wins over options
      assert.strictEqual(m.getThreshold("pg"), 300);
    });

    it("handles scoped driver names like @elastic/elasticsearch", () => {
      process.env.ARGUS_SLOW_QUERY_THRESHOLD_ELASTIC_ELASTICSEARCH = "2000";
      const m = new SlowQueryMonitor({ defaultThresholdMs: 1000 });
      assert.strictEqual(m.getThreshold("@elastic/elasticsearch"), 2000);
    });
  });
});
