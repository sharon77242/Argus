import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  PoolMonitor,
  type PoolLike,
  type PoolExhaustionEvent,
  type SlowAcquireEvent,
} from "../../src/profiling/pool-monitor.ts";

/** Build a mock pool with controllable stats. */
function makeMockPool(overrides: Partial<PoolLike> = {}): PoolLike & {
  emit(event: string): void;
  _listeners: Map<string, Set<(...args: unknown[]) => void>>;
} {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    totalCount: 5,
    idleCount: 2,
    waitingCount: 0,
    ...overrides,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn as (...args: unknown[]) => void);
    },
    removeListener(event, fn) {
      listeners.get(event)?.delete(fn as (...args: unknown[]) => void);
    },
    emit(event: string) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
    _listeners: listeners,
  };
}

describe("PoolMonitor", () => {
  let monitor: PoolMonitor;

  beforeEach(() => {
    monitor = new PoolMonitor({ maxWaitingCount: 3, maxWaitMs: 500, checkIntervalMs: 50 });
  });

  afterEach(() => {
    monitor.stop();
  });

  // ── watch / unwatch / stop ────────────────────────────────────────────────

  it("watch() registers a pool and increments poolCount", () => {
    const pool = makeMockPool();
    monitor.watch(pool, "pg");
    assert.strictEqual(monitor.poolCount, 1);
  });

  it("watch() is idempotent — watching same pool twice is a no-op", () => {
    const pool = makeMockPool();
    monitor.watch(pool, "pg");
    monitor.watch(pool, "pg");
    assert.strictEqual(monitor.poolCount, 1);
  });

  it("unwatch() removes the pool and cleans up listeners", () => {
    const pool = makeMockPool();
    monitor.watch(pool, "pg");
    monitor.unwatch(pool);
    assert.strictEqual(monitor.poolCount, 0);
    assert.strictEqual(pool._listeners.get("acquire")?.size ?? 0, 0);
  });

  it("stop() unregisters all pools", () => {
    const p1 = makeMockPool();
    const p2 = makeMockPool();
    monitor.watch(p1, "pg");
    monitor.watch(p2, "mysql2");
    monitor.stop();
    assert.strictEqual(monitor.poolCount, 0);
  });

  it("unwatch() on an unwatched pool is a no-op", () => {
    const pool = makeMockPool();
    assert.doesNotThrow(() => monitor.unwatch(pool));
  });

  // ── pool-exhaustion ────────────────────────────────────────────────────────

  it("fires pool-exhaustion when waitingCount >= maxWaitingCount", async () => {
    const pool = makeMockPool({ waitingCount: 5 }); // 5 >= 3
    const events: PoolExhaustionEvent[] = [];
    monitor.on("pool-exhaustion", (e: PoolExhaustionEvent) => events.push(e));

    monitor.watch(pool, "pg");
    await new Promise((r) => setTimeout(r, 120)); // wait for at least 2 poll ticks

    assert.ok(events.length >= 1);
    assert.strictEqual(events[0].driver, "pg");
    assert.strictEqual(events[0].waitingCount, 5);
    assert.ok("totalCount" in events[0]);
    assert.ok("idleCount" in events[0]);
    assert.ok("timestamp" in events[0]);
  });

  it("does not fire pool-exhaustion when waitingCount < maxWaitingCount", async () => {
    const pool = makeMockPool({ waitingCount: 1 }); // 1 < 3
    const events: PoolExhaustionEvent[] = [];
    monitor.on("pool-exhaustion", (e: PoolExhaustionEvent) => events.push(e));

    monitor.watch(pool, "pg");
    await new Promise((r) => setTimeout(r, 120));

    assert.strictEqual(events.length, 0);
  });

  // ── slow-acquire via 'acquire' event ──────────────────────────────────────

  it("fires slow-acquire when acquire event fires after waitStartAt exceeds maxWaitMs", async () => {
    const pool = makeMockPool({ waitingCount: 1 });
    const events: SlowAcquireEvent[] = [];
    monitor.on("slow-acquire", (e: SlowAcquireEvent) => events.push(e));

    monitor.watch(pool, "pg");
    await new Promise((r) => setTimeout(r, 60)); // allow one poll to detect waitingCount=1

    // Simulate a slow acquire: backdate the waitStartAt by overriding it
    const reg = (monitor as unknown as { registrations: Map<PoolLike, { waitStartAt: number | null }> })
      .registrations.get(pool);
    if (reg) reg.waitStartAt = Date.now() - 800; // 800ms > 500ms threshold

    pool.emit("acquire"); // trigger the acquire listener

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].driver, "pg");
    assert.ok(events[0].waitMs >= 800);
  });

  it("does not fire slow-acquire when acquire is fast", async () => {
    const pool = makeMockPool({ waitingCount: 1 });
    const events: SlowAcquireEvent[] = [];
    monitor.on("slow-acquire", (e: SlowAcquireEvent) => events.push(e));

    monitor.watch(pool, "pg");
    await new Promise((r) => setTimeout(r, 60));

    const reg = (monitor as unknown as { registrations: Map<PoolLike, { waitStartAt: number | null }> })
      .registrations.get(pool);
    if (reg) reg.waitStartAt = Date.now() - 10; // 10ms < 500ms threshold

    pool.emit("acquire");

    assert.strictEqual(events.length, 0);
  });

  it("does not fire slow-acquire when waitStartAt is null at acquire time", async () => {
    const pool = makeMockPool({ waitingCount: 0 });
    const events: SlowAcquireEvent[] = [];
    monitor.on("slow-acquire", (e: SlowAcquireEvent) => events.push(e));

    monitor.watch(pool, "pg");
    await new Promise((r) => setTimeout(r, 60));

    pool.emit("acquire"); // waitStartAt was never set (no one was waiting)

    assert.strictEqual(events.length, 0);
  });

  // ── slow-acquire via polling fallback (no 'acquire' event) ────────────────

  it("fires slow-acquire via polling when pool has no acquire event", async () => {
    const pool: PoolLike = { totalCount: 5, idleCount: 0, waitingCount: 2 };
    const events: SlowAcquireEvent[] = [];
    monitor = new PoolMonitor({ maxWaitMs: 10, checkIntervalMs: 30 });
    monitor.on("slow-acquire", (e: SlowAcquireEvent) => events.push(e));

    monitor.watch(pool, "pg");
    await new Promise((r) => setTimeout(r, 30)); // first poll: waitStart recorded

    pool.waitingCount = 0; // simulate connection acquired
    await new Promise((r) => setTimeout(r, 40)); // second poll: detects drop, measures waitMs

    assert.ok(events.length >= 1, "should fire slow-acquire via polling");
    assert.ok(events[0].waitMs >= 10);
    monitor.stop();
  });

  // ── multiple pools ────────────────────────────────────────────────────────

  it("monitors multiple pools independently", async () => {
    const pg = makeMockPool({ waitingCount: 5 });
    const redis = makeMockPool({ waitingCount: 0 });
    const pgEvents: PoolExhaustionEvent[] = [];

    monitor.on("pool-exhaustion", (e: PoolExhaustionEvent) => {
      if (e.driver === "pg") pgEvents.push(e);
    });

    monitor.watch(pg, "pg");
    monitor.watch(redis, "redis");

    await new Promise((r) => setTimeout(r, 120));

    assert.ok(pgEvents.length >= 1);
  });
});
