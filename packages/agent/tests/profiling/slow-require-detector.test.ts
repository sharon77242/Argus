import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SlowRequireDetector } from '../../src/profiling/slow-require-detector.ts';

describe('SlowRequireDetector', () => {
  test('instantiates without throwing', () => {
    assert.doesNotThrow(() => new SlowRequireDetector());
    assert.doesNotThrow(() => new SlowRequireDetector({ thresholdMs: 50 }));
  });

  test('patch() returns this for chaining', () => {
    const d = new SlowRequireDetector();
    const result = d.patch();
    assert.equal(result, d);
    d.unpatch();
  });

  test('getSlowModules returns empty array when nothing recorded', () => {
    const d = new SlowRequireDetector({ thresholdMs: 100 });
    assert.deepEqual(d.getSlowModules(), []);
  });

  test('getAllTimings returns empty array when nothing recorded', () => {
    const d = new SlowRequireDetector({ thresholdMs: 100 });
    assert.deepEqual(d.getAllTimings(), []);
  });

  test('ignores modules below threshold', () => {
    const d = new SlowRequireDetector({ thresholdMs: 1000 });
    // Manually insert a timing below threshold
    (d as unknown as { timings: Map<string, number> }).timings.set('fast-module', 50);
    assert.deepEqual(d.getSlowModules(), []);
    assert.equal(d.getAllTimings().length, 1); // getAllTimings returns all, including below threshold
  });

  test('captures slow module above threshold', () => {
    const d = new SlowRequireDetector({ thresholdMs: 100 });
    // Manually insert a timing above threshold
    (d as unknown as { timings: Map<string, number> }).timings.set('slow-module', 500);
    const slow = d.getSlowModules();
    assert.equal(slow.length, 1);
    assert.equal(slow[0].module, 'slow-module');
    assert.equal(slow[0].durationMs, 500);
  });

  test('getSlowModules returns results sorted descending by duration', () => {
    const d = new SlowRequireDetector({ thresholdMs: 50 });
    const timings = (d as unknown as { timings: Map<string, number> }).timings;
    timings.set('module-a', 200);
    timings.set('module-b', 500);
    timings.set('module-c', 100);

    const slow = d.getSlowModules();
    assert.equal(slow[0].module, 'module-b');
    assert.equal(slow[1].module, 'module-a');
    assert.equal(slow[2].module, 'module-c');
  });

  test('unpatch() is idempotent (does not throw on double call)', () => {
    const d = new SlowRequireDetector();
    d.patch();
    assert.doesNotThrow(() => {
      d.unpatch();
      d.unpatch(); // second call should be no-op
    });
  });

  test('does not patch after unpatch', () => {
    const d = new SlowRequireDetector();
    d.patch();
    d.unpatch();
    // State should be inactive
    assert.equal((d as unknown as { active: boolean }).active, false);
  });
});
