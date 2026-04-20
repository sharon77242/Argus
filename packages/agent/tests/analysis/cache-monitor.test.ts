import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { CacheMonitor, type CacheDegradedEvent } from "../../src/analysis/cache-monitor.ts";
import type { TracedQuery } from "../../src/instrumentation/engine.ts";

function makeQuery(overrides: Partial<TracedQuery> = {}): TracedQuery {
  return {
    sanitizedQuery: "GET key",
    durationMs: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("CacheMonitor", () => {
  let monitor: CacheMonitor;

  afterEach(() => {
    monitor.stop();
  });

  // ── lifecycle / wiring ────────────────────────────────────────────────────

  it("stop() is safe before attach()", () => {
    monitor = new CacheMonitor();
    assert.doesNotThrow(() => monitor.stop());
  });

  it("attach() is idempotent", () => {
    monitor = new CacheMonitor({ minSamples: 1, minHitRate: 0.5 });
    const src = new EventEmitter();
    monitor.attach(src);
    monitor.attach(src); // second attach is a no-op
    // fire 1 miss — should only process once
    const events: CacheDegradedEvent[] = [];
    monitor.on("cache-degraded", (e) => events.push(e));
    src.emit("query", makeQuery({ driver: "redis", cacheHit: false }));
    assert.strictEqual(events.length, 1);
  });

  it("detach() stops receiving events", () => {
    monitor = new CacheMonitor({ minSamples: 1, minHitRate: 0.5 });
    const src = new EventEmitter();
    monitor.attach(src);
    monitor.detach(src);

    const events: CacheDegradedEvent[] = [];
    monitor.on("cache-degraded", (e) => events.push(e));
    src.emit("query", makeQuery({ driver: "redis", cacheHit: false }));
    assert.strictEqual(events.length, 0);
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  it("getStats returns null when no samples exist", () => {
    monitor = new CacheMonitor();
    assert.strictEqual(monitor.getStats("redis"), null);
  });

  it("getStats returns correct hit/miss counts", () => {
    monitor = new CacheMonitor({ windowMs: 60_000 });
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: true }));
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: true }));
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: false }));

    const stats = monitor.getStats("redis");
    assert.ok(stats);
    assert.strictEqual(stats.hitCount, 2);
    assert.strictEqual(stats.missCount, 1);
    assert.ok(Math.abs(stats.hitRate - 2 / 3) < 0.01);
    assert.strictEqual(stats.driver, "redis");
  });

  it("getStats is per-driver — other drivers not included", () => {
    monitor = new CacheMonitor();
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: true }));
    monitor._onQuery(makeQuery({ driver: "ioredis", cacheHit: false }));

    const redisStats = monitor.getStats("redis");
    assert.ok(redisStats);
    assert.strictEqual(redisStats.hitCount, 1);
    assert.strictEqual(redisStats.missCount, 0);

    const ioredisStats = monitor.getStats("ioredis");
    assert.ok(ioredisStats);
    assert.strictEqual(ioredisStats.hitCount, 0);
    assert.strictEqual(ioredisStats.missCount, 1);
  });

  // ── cache-degraded events ─────────────────────────────────────────────────

  it("fires cache-degraded when hit rate drops below minHitRate", () => {
    monitor = new CacheMonitor({ minSamples: 3, minHitRate: 0.5 });
    const events: CacheDegradedEvent[] = [];
    monitor.on("cache-degraded", (e) => events.push(e));

    // 1 hit + 2 misses = 33% < 50% threshold
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: true }));
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: false }));
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: false }));

    assert.ok(events.length >= 1);
    assert.ok(events[0].hitRate < 0.5);
    assert.strictEqual(events[0].driver, "redis");
  });

  it("does not fire when hit rate is above minHitRate", () => {
    monitor = new CacheMonitor({ minSamples: 3, minHitRate: 0.3 });
    const events: CacheDegradedEvent[] = [];
    monitor.on("cache-degraded", (e) => events.push(e));

    // 2 hits + 1 miss = 67% > 30%
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: true }));
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: true }));
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: false }));

    assert.strictEqual(events.length, 0);
  });

  it("does not fire before minSamples threshold", () => {
    monitor = new CacheMonitor({ minSamples: 5, minHitRate: 0.5 });
    const events: CacheDegradedEvent[] = [];
    monitor.on("cache-degraded", (e) => events.push(e));

    // Only 3 samples — below minSamples=5
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: false }));
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: false }));
    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: false }));

    assert.strictEqual(events.length, 0);
  });

  it("ignores queries without cacheHit field", () => {
    monitor = new CacheMonitor({ minSamples: 1, minHitRate: 0 });
    const events: CacheDegradedEvent[] = [];
    monitor.on("cache-degraded", (e) => events.push(e));

    // cacheHit is undefined — should be ignored
    monitor._onQuery(makeQuery({ driver: "pg" }));
    assert.strictEqual(events.length, 0);
    assert.strictEqual(monitor.getStats("pg"), null);
  });

  it("ignores queries without driver field", () => {
    monitor = new CacheMonitor({ minSamples: 1, minHitRate: 0 });
    const events: CacheDegradedEvent[] = [];
    monitor.on("cache-degraded", (e) => events.push(e));

    monitor._onQuery(makeQuery({ cacheHit: false })); // no driver
    assert.strictEqual(events.length, 0);
  });

  it("event carries all required fields", () => {
    monitor = new CacheMonitor({ minSamples: 1, minHitRate: 1 }); // 100% required → any miss fires
    const events: CacheDegradedEvent[] = [];
    monitor.on("cache-degraded", (e) => events.push(e));

    monitor._onQuery(makeQuery({ driver: "redis", cacheHit: false }));
    assert.ok("hitCount" in events[0]);
    assert.ok("missCount" in events[0]);
    assert.ok("hitRate" in events[0]);
    assert.ok("windowMs" in events[0]);
    assert.ok("driver" in events[0]);
    assert.ok("timestamp" in events[0]);
  });
});
