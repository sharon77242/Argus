import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceLeakMonitor, type ResourceLeakEvent } from '../../src/profiling/resource-leak-monitor.ts';

describe('ResourceLeakMonitor', () => {
  it('should emit an anomaly if handle threshold is breached', async () => {
    // Skip if process.getActiveResourcesInfo is not supported
    if (typeof process.getActiveResourcesInfo !== 'function') return;

    // Use a very low threshold to guarantee a trigger
    const monitor = new ResourceLeakMonitor({ handleThreshold: 1, intervalMs: 10 });
    let leakSpotted: ResourceLeakEvent | null = null;

    monitor.on('leak', (event) => {
      leakSpotted = event;
    });

    monitor.start();

    await new Promise(r => setTimeout(r, 50));

    monitor.stop();

    assert.ok(leakSpotted);
    assert.ok(leakSpotted.handlesCount >= 1);
    assert.strictEqual(leakSpotted.suggestions[0].rule, 'resource-exhaustion');
  });
});
