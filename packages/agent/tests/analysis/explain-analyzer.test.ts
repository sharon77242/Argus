import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ExplainAnalyzer, type ExplainResult } from "../../src/analysis/explain-analyzer.ts";
import type { TracedQuery } from "../../src/instrumentation/engine.ts";

function makeQuery(overrides: Partial<TracedQuery> = {}): TracedQuery {
  return {
    sanitizedQuery: "SELECT * FROM users WHERE id = ?",
    durationMs: 200,
    timestamp: Date.now(),
    driver: "pg",
    ...overrides,
  };
}

describe("ExplainAnalyzer", () => {
  let analyzer: ExplainAnalyzer;

  afterEach(() => {
    analyzer.stop();
  });

  // ── analyze() direct API ──────────────────────────────────────────────────

  it("analyze() calls executor with normalized query", async () => {
    const calls: string[] = [];
    analyzer = new ExplainAnalyzer({
      executor: async (q) => {
        calls.push(q);
        return [{ type: "Seq Scan" }];
      },
    });

    const result = await analyzer.analyze("SELECT * FROM users WHERE id = ?");
    assert.ok(result);
    assert.ok(calls[0].includes("NULL"));
    assert.ok(!calls[0].includes("?"));
  });

  it("analyze() returns ExplainResult with correct shape", async () => {
    analyzer = new ExplainAnalyzer({
      executor: async () => [{ "QUERY PLAN": "Seq Scan on users" }],
    });

    const result = await analyzer.analyze("SELECT * FROM t WHERE x = $1");
    assert.ok(result);
    assert.ok("query" in result);
    assert.ok("normalizedQuery" in result);
    assert.ok("plan" in result);
    assert.ok("timestamp" in result);
    assert.ok("durationMs" in result);
    assert.ok(result.normalizedQuery.includes("NULL"));
    assert.ok(!result.normalizedQuery.includes("$1"));
  });

  it("analyze() returns null when executor throws", async () => {
    analyzer = new ExplainAnalyzer({
      executor: async () => {
        throw new Error("db error");
      },
    });

    const result = await analyzer.analyze("SELECT 1");
    assert.strictEqual(result, null);
  });

  // ── auto-attach path ──────────────────────────────────────────────────────

  it("fires 'explain' event for slow queries above threshold", async () => {
    analyzer = new ExplainAnalyzer({
      executor: async () => [{ type: "Index Scan" }],
      slowThresholdMs: 100,
      cooldownMs: 0,
    });

    const src = new EventEmitter();
    analyzer.attach(src);

    const events: ExplainResult[] = [];
    analyzer.on("explain", (e) => events.push(e));

    src.emit("query", makeQuery({ durationMs: 200 })); // 200ms > 100ms threshold
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(events.length, 1);
    assert.ok(events[0].plan.length > 0);
  });

  it("does not fire for fast queries below threshold", async () => {
    analyzer = new ExplainAnalyzer({
      executor: async () => [{ type: "Index Scan" }],
      slowThresholdMs: 500,
      cooldownMs: 0,
    });

    const src = new EventEmitter();
    analyzer.attach(src);

    const events: ExplainResult[] = [];
    analyzer.on("explain", (e) => events.push(e));

    src.emit("query", makeQuery({ durationMs: 10 })); // 10ms < 500ms threshold
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(events.length, 0);
  });

  it("respects cooldownMs — same query pattern is not EXPLAINed twice quickly", async () => {
    let callCount = 0;
    analyzer = new ExplainAnalyzer({
      executor: async () => {
        callCount++;
        return [];
      },
      slowThresholdMs: 0,
      cooldownMs: 60_000, // 1 minute cooldown
    });

    const src = new EventEmitter();
    analyzer.attach(src);

    src.emit("query", makeQuery({ sanitizedQuery: "SELECT * FROM t WHERE id = ?" }));
    src.emit("query", makeQuery({ sanitizedQuery: "SELECT * FROM t WHERE id = ?" }));
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(callCount, 1);
  });

  it("emits 'error' event when executor throws in attach path", async () => {
    analyzer = new ExplainAnalyzer({
      executor: async () => {
        throw new Error("explain failed");
      },
      slowThresholdMs: 0,
      cooldownMs: 0,
    });

    const src = new EventEmitter();
    analyzer.attach(src);

    const errors: Error[] = [];
    analyzer.on("error", (e) => errors.push(e));

    src.emit("query", makeQuery());
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].message, "explain failed");
  });

  it("normalizes both ? and $N placeholders to NULL", () => {
    analyzer = new ExplainAnalyzer({ executor: async () => [] });
    const normalized = (analyzer as unknown as { _normalize(q: string): string })._normalize(
      "SELECT * FROM t WHERE a = ? AND b = $2 AND c = $10",
    );
    assert.ok(!normalized.includes("?"));
    assert.ok(!normalized.includes("$2"));
    assert.ok(!normalized.includes("$10"));
    assert.ok(normalized.includes("NULL"));
  });

  it("detach() stops firing events", async () => {
    analyzer = new ExplainAnalyzer({
      executor: async () => [{ type: "Seq Scan" }],
      slowThresholdMs: 0,
      cooldownMs: 0,
    });

    const src = new EventEmitter();
    analyzer.attach(src);
    analyzer.detach(src);

    const events: ExplainResult[] = [];
    analyzer.on("explain", (e) => events.push(e));

    src.emit("query", makeQuery({ durationMs: 999 }));
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(events.length, 0);
  });

  it("attach() is idempotent", async () => {
    let callCount = 0;
    analyzer = new ExplainAnalyzer({
      executor: async () => {
        callCount++;
        return [];
      },
      slowThresholdMs: 0,
      cooldownMs: 0,
    });

    const src = new EventEmitter();
    analyzer.attach(src);
    analyzer.attach(src);

    src.emit("query", makeQuery());
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(callCount, 1);
  });
});
