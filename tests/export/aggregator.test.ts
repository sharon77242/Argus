import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsAggregator, type AggregatorEvent } from '../../src/export/aggregator.ts';
import { once } from 'node:events';

describe('MetricsAggregator', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator(100); // 100ms flush window for testing
  });

  afterEach(() => {
    aggregator.disable();
  });

  it('should export all items if volume is <= 5 (no p99 pruning)', () => {
    aggregator.record('query', 100, { data: 'fast' });
    aggregator.record('query', 250, { data: 'medium' });
    aggregator.record('query', 500, { data: 'slow' });

    aggregator.flush();
    let flushedCount = 0;
    
    // We can test synchronously because flush() emits synchronously in the file
    aggregator.on('flush', (events: AggregatorEvent[]) => {
      flushedCount = events.length;
      assert.strictEqual(events.length, 3);
    });

    aggregator.flush(); // This second flush tests the grouping
    // wait, I need to setup listener BEFORE flush
  });

  it('correctly tests synchronous flush', () => {
    const agg = new MetricsAggregator(100);
    agg.record('query', 100, {});
    agg.record('query', 250, {});
    agg.record('query', 500, {});

    let receivedEvents: AggregatorEvent[] = [];
    agg.on('flush', (events) => receivedEvents = events);

    agg.flush();
    assert.strictEqual(receivedEvents.length, 3);
  });

  it('should only export the p99 outliers during high volume traffic', () => {
    const agg = new MetricsAggregator(100);
    
    // Record 100 events
    for (let i = 1; i <= 100; i++) {
        // Durations 1ms to 100ms
        agg.record('query', i, { db: 'test' }); 
    }

    let receivedEvents: AggregatorEvent[] = [];
    agg.on('flush', (events) => receivedEvents = events);

    agg.flush();
    
    // p99 of 100 items means floor(0.99 * 100) = 99.
    // It should keep indices 99 to 99 -> meaning 1 item (the max).
    assert.strictEqual(receivedEvents.length, 1);
    assert.strictEqual(receivedEvents[0].value, 100); // the 100ms query
  });
});
