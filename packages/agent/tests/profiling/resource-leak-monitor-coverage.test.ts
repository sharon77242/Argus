/**
 * Additional coverage tests for ResourceLeakMonitor
 * Targets: process.getActiveResourcesInfo not available (lines 41-43)
 *          and start() idempotency (line 26)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ResourceLeakMonitor,
  type ResourceLeakEvent,
} from "../../src/profiling/resource-leak-monitor.ts";

describe("ResourceLeakMonitor (coverage)", () => {
  // ── No getActiveResourcesInfo API ─────────────────────────────────────────
  it("should silently skip check when process.getActiveResourcesInfo is unavailable", async () => {
    const original = process.getActiveResourcesInfo;
    (process as any).getActiveResourcesInfo = undefined;

    const monitor = new ResourceLeakMonitor({
      handleThreshold: 0,
      intervalMs: 10,
    });

    const leaks: ResourceLeakEvent[] = [];
    monitor.on("leak", (e) => leaks.push(e));

    monitor.start();

    await new Promise((r) => setTimeout(r, 80));
    monitor.stop();

    // Restore
    (process as any).getActiveResourcesInfo = original;

    assert.strictEqual(leaks.length, 0, "Should not emit leaks when API is unavailable");
  });

  // ── start() idempotency ───────────────────────────────────────────────────
  it("start() should be idempotent", () => {
    const monitor = new ResourceLeakMonitor({ intervalMs: 9999 });
    monitor.start();
    const timerBefore = (monitor as any).timer;
    monitor.start(); // second call
    const timerAfter = (monitor as any).timer;
    assert.strictEqual(timerBefore, timerAfter, "Timer should not be replaced on second start()");
    monitor.stop();
  });

  // ── stop() when not started ───────────────────────────────────────────────
  it("stop() should be safe to call when not started", () => {
    const monitor = new ResourceLeakMonitor();
    assert.doesNotThrow(() => {
      monitor.stop();
      monitor.stop();
    });
  });

  // ── alertCooldownMs: rate-limiting repeated leak alerts ───────────────────
  it("should suppress repeated leak alerts within alertCooldownMs window", async () => {
    // Mock getActiveResourcesInfo so threshold is always exceeded
    const original = process.getActiveResourcesInfo;
    (process as any).getActiveResourcesInfo = () => new Array(9999).fill("TCPSocket");

    const monitor = new ResourceLeakMonitor({
      handleThreshold: 100, // 9999 > 100 → always above threshold
      intervalMs: 20,
      alertCooldownMs: 500,
    });

    const leaks: ResourceLeakEvent[] = [];
    monitor.on("leak", (e) => leaks.push(e));
    monitor.start();

    // Run for 120ms — should only fire once despite 6 checks
    await new Promise((r) => setTimeout(r, 120));
    monitor.stop();
    (process as any).getActiveResourcesInfo = original;

    assert.strictEqual(
      leaks.length,
      1,
      "Should emit exactly 1 alert within 500ms cooldown, not one per interval",
    );
  });

  it("alertCooldownMs: should fire again after cooldown expires", async () => {
    const original = process.getActiveResourcesInfo;
    (process as any).getActiveResourcesInfo = () => new Array(9999).fill("TCPSocket");

    const monitor = new ResourceLeakMonitor({
      handleThreshold: 100,
      intervalMs: 10,
      alertCooldownMs: 50,
    });

    const leaks: ResourceLeakEvent[] = [];
    monitor.on("leak", (e) => leaks.push(e));
    monitor.start();

    // Run for 130ms — expect ≥2 alerts (t≈0ms and t≈50ms)
    await new Promise((r) => setTimeout(r, 130));
    monitor.stop();
    (process as any).getActiveResourcesInfo = original;

    assert.ok(
      leaks.length >= 2,
      `Should emit at least 2 alerts after cooldown expires (got ${leaks.length})`,
    );
  });
});
