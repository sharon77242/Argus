import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GcMonitor, type GcPressureEvent } from "../../src/profiling/gc-monitor.ts";

describe("GcMonitor", () => {
  let monitor: GcMonitor;

  afterEach(() => {
    monitor.stop();
  });

  // ── lifecycle ─────────────────────────────────────────────────────────────

  it("start() is idempotent", () => {
    monitor = new GcMonitor();
    monitor.start();
    monitor.start(); // second call must not throw or double-register
    assert.strictEqual(monitor.isActive, true);
  });

  it("stop() is idempotent", () => {
    monitor = new GcMonitor();
    monitor.start();
    monitor.stop();
    monitor.stop(); // second call must not throw
    assert.strictEqual(monitor.isActive, false);
  });

  it("isActive reflects start/stop state", () => {
    monitor = new GcMonitor();
    assert.strictEqual(monitor.isActive, false);
    monitor.start();
    assert.strictEqual(monitor.isActive, true);
    monitor.stop();
    assert.strictEqual(monitor.isActive, false);
  });

  // ── threshold logic ───────────────────────────────────────────────────────

  it("fires gc-pressure when pause % exceeds threshold", () => {
    monitor = new GcMonitor({ windowMs: 1000, pausePctThreshold: 5 });

    const events: GcPressureEvent[] = [];
    monitor.on("gc-pressure", (e: GcPressureEvent) => events.push(e));

    // 100 ms pause in a 1000 ms window = 10% > 5% threshold
    monitor._injectGcPause(100);

    assert.strictEqual(events.length, 1);
    assert.ok(events[0].totalPauseMs >= 100);
    assert.ok(events[0].pausePct >= 5);
    assert.strictEqual(events[0].gcCount, 1);
    assert.strictEqual(events[0].windowMs, 1000);
  });

  it("does not fire below threshold", () => {
    monitor = new GcMonitor({ windowMs: 10_000, pausePctThreshold: 50 });

    const events: GcPressureEvent[] = [];
    monitor.on("gc-pressure", (e: GcPressureEvent) => events.push(e));

    // 100 ms in 10 000 ms window = 1% < 50% threshold
    monitor._injectGcPause(100);

    assert.strictEqual(events.length, 0);
  });

  it("accumulates multiple pauses within the window", () => {
    monitor = new GcMonitor({ windowMs: 1000, pausePctThreshold: 20 });

    const events: GcPressureEvent[] = [];
    monitor.on("gc-pressure", (e: GcPressureEvent) => events.push(e));

    // 3 × 80 ms = 240 ms in 1000 ms = 24% > 20%
    monitor._injectGcPause(80);
    monitor._injectGcPause(80);
    monitor._injectGcPause(80);

    assert.strictEqual(events.length, 1);
    assert.ok(events[0].totalPauseMs >= 240);
    assert.strictEqual(events[0].gcCount, 3);
  });

  it("resets samples after firing so same pauses don't re-trigger", () => {
    monitor = new GcMonitor({ windowMs: 1000, pausePctThreshold: 5 });

    const events: GcPressureEvent[] = [];
    monitor.on("gc-pressure", (e: GcPressureEvent) => events.push(e));

    monitor._injectGcPause(100); // fires → samples cleared
    // Re-inject a small pause that alone is below threshold
    monitor._injectGcPause(1); // 1ms / 1000ms = 0.1% < 5% → no second event

    assert.strictEqual(events.length, 1);
  });

  it("evicts samples outside the sliding window", () => {
    monitor = new GcMonitor({ windowMs: 100, pausePctThreshold: 50 });

    const events: GcPressureEvent[] = [];
    monitor.on("gc-pressure", (e: GcPressureEvent) => events.push(e));

    const past = Date.now() - 200; // 200ms ago, outside 100ms window
    monitor._injectGcPause(90, past); // would be 90% if inside window — should be evicted

    assert.strictEqual(events.length, 0, "old sample must be evicted, not counted");
  });

  it("event carries correct fields", () => {
    monitor = new GcMonitor({ windowMs: 1000, pausePctThreshold: 5 });

    const events: GcPressureEvent[] = [];
    monitor.on("gc-pressure", (e: GcPressureEvent) => events.push(e));

    monitor._injectGcPause(200);

    assert.ok("totalPauseMs" in events[0]);
    assert.ok("pausePct" in events[0]);
    assert.ok("gcCount" in events[0]);
    assert.ok("windowMs" in events[0]);
    assert.ok("timestamp" in events[0]);
    assert.ok(events[0].timestamp <= Date.now());
  });

  // ── _injectGcPause without start() ────────────────────────────────────────

  it("_injectGcPause works without calling start() first (direct testing path)", () => {
    monitor = new GcMonitor({ windowMs: 1000, pausePctThreshold: 5 });

    const events: GcPressureEvent[] = [];
    monitor.on("gc-pressure", (e: GcPressureEvent) => events.push(e));

    // Should not throw even without a live PerformanceObserver
    assert.doesNotThrow(() => monitor._injectGcPause(100));
    assert.strictEqual(events.length, 1);
  });
});
