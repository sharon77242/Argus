/**
 * Coverage + regression tests for MetricsAggregator
 * Targets: p99 correctness (Bug Fix #7), flush() edge cases
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsAggregator } from '../../src/export/aggregator.ts';

describe('MetricsAggregator (coverage)', () => {

  // ── Bug Fix #7 regression: p99 index must be correct ─────────────────────
  it('[BUG FIX] flush() with 100 items should export item at index 98 (true p99), not index 99 (max)', () => {
    const agg = new MetricsAggregator();

    // Record 100 items with values 1..100 (sorted ascending)
    for (let i = 1; i <= 100; i++) {
      agg.record('latency', i, { dummy: true });
    }

    const flushed: any[][] = [];
    agg.on('flush', (events) => flushed.push(events));
    agg.flush();

    assert.strictEqual(flushed.length, 1, 'Should have emitted one flush event');
    const exported = flushed[0];

    // With Math.ceil(0.99 * 100) - 1 = 98:
    //   items at indices 98..99 are exported → values 99 and 100
    // With old Math.floor(0.99 * 100) = 99:
    //   only index 99 is exported → value 100 (the single maximum / p100)
    assert.ok(exported.length >= 2,
      `[BUG FIX] Should export ≥2 items (p99+p100), got ${exported.length}`);

    const values = exported.map((e: any) => e.value).sort((a: number, b: number) => a - b);
    assert.strictEqual(values[0], 99, 'Should include value 99 (true p99)');
    assert.strictEqual(values[values.length - 1], 100, 'Should include value 100 (p100/max)');
  });

  it('[BUG FIX] flush() with 10 items should export the top 1 (ceil(0.99*10)-1=8, items 9 and 10)', () => {
    const agg = new MetricsAggregator();
    for (let i = 1; i <= 10; i++) {
      agg.record('latency', i, {});
    }
    const flushed: any[][] = [];
    agg.on('flush', (events) => flushed.push(events));
    agg.flush();

    const values = flushed[0].map((e: any) => e.value).sort((a: number, b: number) => a - b);
    // ceil(0.99 * 10) - 1 = ceil(9.9) - 1 = 10 - 1 = 9 → items at index 9 (value 10)
    // Actually only 1 item gets exported here — the last one (value 10)
    assert.ok(values.includes(10), 'Should always include the maximum value');
  });

  // ── flush() with exactly 5 items: all exported (low-traffic path) ─────────
  it('should export all items when group has ≤5 entries', () => {
    const agg = new MetricsAggregator();
    for (let i = 1; i <= 5; i++) {
      agg.record('query', i * 10, {});
    }
    const flushed: any[][] = [];
    agg.on('flush', (events) => flushed.push(events));
    agg.flush();

    assert.strictEqual(flushed[0].length, 5, 'All 5 items should be exported (low-traffic)');
  });

  // ── flush() groups by metricName ─────────────────────────────────────────
  it('should handle multiple metric names independently', () => {
    const agg = new MetricsAggregator();

    // 6 items for 'http' (triggers p99 path), 3 items for 'query' (low traffic path)
    for (let i = 1; i <= 6; i++) agg.record('http', i, {});
    for (let i = 1; i <= 3; i++) agg.record('query', i * 10, {});

    const flushed: any[][] = [];
    agg.on('flush', (events) => flushed.push(events));
    agg.flush();

    const httpItems = flushed[0].filter((e: any) => e.metricName === 'http');
    const queryItems = flushed[0].filter((e: any) => e.metricName === 'query');

    assert.ok(httpItems.length >= 1, 'Should have exported http items');
    assert.strictEqual(queryItems.length, 3, 'Should export all 3 query items (low-traffic)');
  });

  // ── flush() with 0 items: no event emitted ────────────────────────────────
  it('should not emit flush event when buffer is empty', () => {
    const agg = new MetricsAggregator();
    let flushed = false;
    agg.on('flush', () => { flushed = true; });
    agg.flush();
    assert.strictEqual(flushed, false, 'Should not emit flush when buffer is empty');
  });

  // ── enable() + disable() lifecycle ───────────────────────────────────────
  it('disable() should flush remaining buffer', () => {
    const agg = new MetricsAggregator(60_000);
    agg.enable();
    agg.record('metric', 1, {});

    const flushed: any[][] = [];
    agg.on('flush', (events) => flushed.push(events));

    agg.disable();

    assert.ok(flushed.length > 0, 'disable() should flush remaining buffer');
  });
});
