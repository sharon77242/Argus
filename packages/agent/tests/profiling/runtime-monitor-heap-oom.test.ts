import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RuntimeMonitor, type ProfilerEvent } from "../../src/profiling/runtime-monitor.ts";

describe("RuntimeMonitor — heap-oom-risk", () => {
  it("ProfilerEvent type includes 'heap-oom-risk'", () => {
    const event: ProfilerEvent = {
      type: "heap-oom-risk",
      heapUsagePct: 95,
      timestamp: Date.now(),
    };
    assert.strictEqual(event.type, "heap-oom-risk");
    assert.strictEqual(event.heapUsagePct, 95);
  });

  it("options include heapUsagePctThreshold defaulting to 90", () => {
    const monitor = new RuntimeMonitor({ heapUsagePctThreshold: 90 });
    assert.ok(monitor);
    monitor.stop();
  });

  it("_injectHighHeap fires heap-oom-risk anomaly event", async () => {
    const monitor = new RuntimeMonitor({ heapUsagePctThreshold: 90 });
    const events: ProfilerEvent[] = [];
    monitor.on("anomaly", (e) => events.push(e));
    monitor.on("error", () => { /* ignore snapshot errors */ });

    await monitor._injectHighHeap(92);

    const oomEvents = events.filter((e) => e.type === "heap-oom-risk");
    assert.strictEqual(oomEvents.length, 1);
    assert.strictEqual(oomEvents[0].heapUsagePct, 92);
  });

  it("heap-oom-risk event carries required fields", async () => {
    const monitor = new RuntimeMonitor();
    const events: ProfilerEvent[] = [];
    monitor.on("anomaly", (e) => events.push(e));
    monitor.on("error", () => { /* ignore */ });

    await monitor._injectHighHeap(91);
    monitor.stop();

    assert.strictEqual(events.length, 1);
    assert.ok("type" in events[0]);
    assert.ok("heapUsagePct" in events[0]);
    assert.ok("timestamp" in events[0]);
    assert.ok(events[0].timestamp <= Date.now());
  });

  it("does not fire when heapUsagePctThreshold is 0 (disabled)", async () => {
    const monitor = new RuntimeMonitor({
      heapUsagePctThreshold: 0,
      checkIntervalMs: 15,
    });

    const events: ProfilerEvent[] = [];
    monitor.on("anomaly", (e) => events.push(e));
    monitor.start();

    await new Promise((r) => setTimeout(r, 60));
    monitor.stop();

    const oomEvents = events.filter((e) => e.type === "heap-oom-risk");
    assert.strictEqual(oomEvents.length, 0, "should not fire when threshold is 0");
  });

  it("_injectHighHeap fires with varying percentages", async () => {
    const monitor = new RuntimeMonitor({ heapUsagePctThreshold: 90 });
    const events: ProfilerEvent[] = [];
    monitor.on("anomaly", (e) => events.push(e));
    monitor.on("error", () => { /* ignore snapshot errors */ });

    await monitor._injectHighHeap(95.5);
    await monitor._injectHighHeap(98.1);
    monitor.stop();

    const oomEvents = events.filter((e) => e.type === "heap-oom-risk");
    assert.strictEqual(oomEvents.length, 2);
    assert.ok(Math.abs(oomEvents[0].heapUsagePct! - 95.5) < 0.01);
    assert.ok(Math.abs(oomEvents[1].heapUsagePct! - 98.1) < 0.01);
  });
});
