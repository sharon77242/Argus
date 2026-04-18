import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ResourceLeakMonitor,
  type ResourceLeakEvent,
} from "../../src/profiling/resource-leak-monitor.ts";

describe("ResourceLeakMonitor", () => {
  it("should emit an anomaly if handle threshold is breached", async () => {
    // Skip if process.getActiveResourcesInfo is not supported
    if (typeof process.getActiveResourcesInfo !== "function") return;

    const monitor = new ResourceLeakMonitor({ handleThreshold: 1, intervalMs: 10 });
    const leaks: ResourceLeakEvent[] = [];

    monitor.on("leak", (event: ResourceLeakEvent) => {
      leaks.push(event);
    });

    monitor.start();

    await new Promise((r) => setTimeout(r, 50));

    monitor.stop();

    assert.ok(leaks.length > 0);
    assert.ok(leaks[0].handlesCount >= 1);
    assert.strictEqual(leaks[0].suggestions[0].rule, "resource-exhaustion");
  });
});
