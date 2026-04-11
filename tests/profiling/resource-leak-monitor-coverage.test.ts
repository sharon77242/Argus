/**
 * Additional coverage tests for ResourceLeakMonitor
 * Targets: process.getActiveResourcesInfo not available (lines 41-43)
 *          and start() idempotency (line 26)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceLeakMonitor } from '../../src/profiling/resource-leak-monitor.ts';

describe('ResourceLeakMonitor (coverage)', () => {

  // ── No getActiveResourcesInfo API ─────────────────────────────────────────
  it('should silently skip check when process.getActiveResourcesInfo is unavailable', async () => {
    const original = process.getActiveResourcesInfo;
    (process as any).getActiveResourcesInfo = undefined;

    const monitor = new ResourceLeakMonitor({
      handleThreshold: 0,
      intervalMs: 10,
    });

    const leaks: any[] = [];
    monitor.on('leak', (e) => leaks.push(e));

    monitor.start();

    await new Promise(r => setTimeout(r, 80));
    monitor.stop();

    // Restore
    (process as any).getActiveResourcesInfo = original;

    assert.strictEqual(leaks.length, 0, 'Should not emit leaks when API is unavailable');
  });

  // ── start() idempotency ───────────────────────────────────────────────────
  it('start() should be idempotent', () => {
    const monitor = new ResourceLeakMonitor({ intervalMs: 9999 });
    monitor.start();
    const timerBefore = (monitor as any).timer;
    monitor.start(); // second call
    const timerAfter = (monitor as any).timer;
    assert.strictEqual(timerBefore, timerAfter, 'Timer should not be replaced on second start()');
    monitor.stop();
  });

  // ── stop() when not started ───────────────────────────────────────────────
  it('stop() should be safe to call when not started', () => {
    const monitor = new ResourceLeakMonitor();
    assert.doesNotThrow(() => {
      monitor.stop();
      monitor.stop();
    });
  });
});
