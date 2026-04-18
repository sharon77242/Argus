import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { WorkerThreadsMonitor } from "../../src/profiling/worker-threads-monitor.ts";

describe("WorkerThreadsMonitor", () => {
  test("does not throw when no worker threads are in use", () => {
    const monitor = new WorkerThreadsMonitor();
    assert.doesNotThrow(() => monitor.patch());
    monitor.stop();
  });

  test("metrics are zero when main thread only (no task recorded)", () => {
    const monitor = new WorkerThreadsMonitor();
    monitor.patch();
    const metrics = monitor.getMetrics();
    assert.equal(metrics.activeWorkers, 0);
    assert.equal(metrics.queueDepth, 0);
    assert.equal(metrics.avgTaskDurationMs, 0);
    assert.equal(metrics.idleWorkers, 0);
    monitor.stop();
  });

  test("recordTaskStart increments queueDepth", () => {
    const monitor = new WorkerThreadsMonitor();
    monitor.patch();
    monitor.recordTaskStart();
    monitor.recordTaskStart();
    assert.equal(monitor.getMetrics().queueDepth, 2);
    monitor.stop();
  });

  test("recordTaskEnd decrements queueDepth and records timing", () => {
    const monitor = new WorkerThreadsMonitor();
    monitor.patch();
    const mark = monitor.recordTaskStart();
    assert.equal(monitor.getMetrics().queueDepth, 1);
    monitor.recordTaskEnd(mark);
    assert.equal(monitor.getMetrics().queueDepth, 0);
    assert.ok(
      monitor.getMetrics().avgTaskDurationMs >= 0,
      "avg task duration should be non-negative",
    );
    monitor.stop();
  });

  test("queue depth anomaly fires when threshold exceeded", async () => {
    const anomalies: unknown[] = [];
    const monitor = new WorkerThreadsMonitor({
      queueDepthThreshold: 2,
      pollIntervalMs: 20,
    });
    monitor.on("anomaly", (e) => anomalies.push(e));
    monitor.patch();

    // Add 3 tasks (exceeds threshold of 2)
    monitor.recordTaskStart();
    monitor.recordTaskStart();
    monitor.recordTaskStart();

    // Wait for poll
    await new Promise<void>((r) => setTimeout(r, 50));

    assert.ok(anomalies.length > 0, "Should emit anomaly when queue depth exceeds threshold");
    const anomaly = anomalies[0] as { reason: string };
    assert.equal(anomaly.reason, "queue-depth");

    monitor.stop();
  });

  test("slow task anomaly fires when task exceeds threshold", async () => {
    const anomalies: unknown[] = [];
    const monitor = new WorkerThreadsMonitor({ slowTaskThresholdMs: 10 });
    monitor.on("anomaly", (e) => anomalies.push(e));
    monitor.patch();

    // Simulate a slow task by passing an old startMark
    const oldMark = performance.now() - 50; // 50ms ago — exceeds 10ms threshold
    monitor.recordTaskEnd(oldMark);

    assert.ok(anomalies.length > 0, "Should emit anomaly for slow task");
    const anomaly = anomalies[0] as { reason: string };
    assert.equal(anomaly.reason, "slow-task");

    monitor.stop();
  });

  test("getMetrics reflects recorded task timings", () => {
    const monitor = new WorkerThreadsMonitor();
    monitor.patch();

    const m1 = performance.now() - 100;
    const m2 = performance.now() - 50;
    monitor.recordTaskEnd(m1);
    monitor.recordTaskEnd(m2);

    const metrics = monitor.getMetrics();
    assert.ok(metrics.avgTaskDurationMs > 0, "Average task duration should be positive");

    monitor.stop();
  });

  test("stop() prevents further anomaly events", async () => {
    const anomalies: unknown[] = [];
    const monitor = new WorkerThreadsMonitor({
      queueDepthThreshold: 1,
      pollIntervalMs: 20,
    });
    monitor.on("anomaly", (e) => anomalies.push(e));
    monitor.patch();
    monitor.recordTaskStart();
    monitor.stop();

    await new Promise<void>((r) => setTimeout(r, 60));
    // After stop(), no anomalies should fire even though queue depth > threshold
    assert.equal(anomalies.length, 0, "No anomalies should fire after stop()");
  });
});
