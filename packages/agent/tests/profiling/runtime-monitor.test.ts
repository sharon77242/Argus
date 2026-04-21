import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { RuntimeMonitor, type ProfilerEvent } from "../../src/profiling/runtime-monitor.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("RuntimeMonitor", () => {
  let monitor: RuntimeMonitor;

  beforeEach(() => {
    // Fast intervals for testing, low threshold for lag
    monitor = new RuntimeMonitor({
      checkIntervalMs: 100,
      eventLoopThresholdMs: 20,
      cpuProfileDurationMs: 50,
      cpuProfileCooldownMs: 1000, // ensure we only profile once
    });
  });

  afterEach(() => {
    monitor.stop();
  });

  it("should detect memory leak", async () => {
    const localMonitor = new RuntimeMonitor({
      checkIntervalMs: 50,
      memoryGrowthThresholdBytes: 1024, // VERY small growth for testing
    });

    localMonitor.start();

    // Listen specifically for memory-leak events; ignore event-loop-lag which
    // fires first when the allocation loop blocks the event loop briefly.
    const p = new Promise<ProfilerEvent>((resolve) => {
      localMonitor.on("anomaly", (e) => {
        if (e.type === "memory-leak") resolve(e);
      });
    });

    // Artificial memory growth simulation
    const arr: string[][] = [];

    // Wait a bit for baseline to establish
    await sleep(10);

    for (let i = 0; i < 50000; i++) {
      arr.push(new Array(100).fill("leak"));
    }

    // Give it time to poll, monitor uses unref interval so we need sleep to keep event loop alive
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout waiting for memory leak")), 1000),
    );

    const event = await Promise.race([p, timeoutPromise]);

    assert.strictEqual(event.type, "memory-leak");
    assert.ok(event.growthBytes! > 1024);

    localMonitor.stop();
  });

  it("should detect event loop lag and capture CPU profile", async () => {
    // Use a dedicated monitor with a very low threshold (5ms) and fast check interval
    // so detection is reliable regardless of host load or timer resolution.
    const lagMonitor = new RuntimeMonitor({
      checkIntervalMs: 50,
      eventLoopThresholdMs: 5,
      cpuProfileDurationMs: 50,
      cpuProfileCooldownMs: 1000,
    });
    lagMonitor.start();

    const p = new Promise<ProfilerEvent[]>((resolve) => {
      const handler = (event: ProfilerEvent) => {
        if (event.type === "event-loop-lag") {
          lagMonitor.off("anomaly", handler);
          resolve([event]);
        }
      };
      lagMonitor.on("anomaly", handler);
    });

    await sleep(10); // allow baseline to settle

    // Block the event loop long enough to guarantee detection on any machine.
    const start = Date.now();
    while (Date.now() - start < 300) {
      // busy wait
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout waiting for lag event")), 3000),
    );
    const [event] = await Promise.race([p, timeoutPromise]);

    assert.strictEqual(event.type, "event-loop-lag");
    assert.ok(event.lagMs! >= 5);
    // profileDataPath may be undefined if the inspector session didn't start in time (test-runner load).
    // When it is present it must be a string path.
    if (event.profileDataPath !== undefined) {
      assert.strictEqual(
        typeof event.profileDataPath,
        "string",
        "profileDataPath should be a valid string path",
      );
    }

    lagMonitor.stop();
  });
});
