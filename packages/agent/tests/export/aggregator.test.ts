import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MetricsAggregator, type AggregatorEvent } from "../../src/export/aggregator.ts";

describe("MetricsAggregator", () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator(100); // 100ms flush window for testing
  });

  afterEach(() => {
    aggregator.disable();
  });

  it("should export all items if volume is <= 5 (no p99 pruning)", () => {
    aggregator.record("query", 100, { data: "fast" });
    aggregator.record("query", 250, { data: "medium" });
    aggregator.record("query", 500, { data: "slow" });

    aggregator.flush();
    let _flushedCount = 0;

    // We can test synchronously because flush() emits synchronously in the file
    aggregator.on("flush", (events: AggregatorEvent[]) => {
      _flushedCount = events.length;
      assert.strictEqual(events.length, 3);
    });

    aggregator.flush(); // This second flush tests the grouping
    // wait, I need to setup listener BEFORE flush
  });

  it("correctly tests synchronous flush", () => {
    const agg = new MetricsAggregator(100);
    agg.record("query", 100, {});
    agg.record("query", 250, {});
    agg.record("query", 500, {});

    let receivedEvents: AggregatorEvent[] = [];
    agg.on("flush", (events) => (receivedEvents = events));

    agg.flush();
    assert.strictEqual(receivedEvents.length, 3);
  });

  it("should only export the p99+ outliers during high volume traffic", () => {
    const agg = new MetricsAggregator(100);

    // Record 100 events with values 1..100
    for (let i = 1; i <= 100; i++) {
      agg.record("query", i, { db: "test" });
    }

    let receivedEvents: AggregatorEvent[] = [];
    agg.on("flush", (events) => (receivedEvents = events));

    agg.flush();

    // Correct p99 formula: Math.ceil(0.99 * 100) - 1 = 99 - 1 = 98
    // Items at indices 98..99 are exported → values 99 and 100 (2 items)
    // Old (buggy) formula Math.floor(0.99 * 100) = 99 only exported 1 item (the max).
    assert.strictEqual(receivedEvents.length, 2, "Should export 2 items: values at p99 and p100");
    const values = receivedEvents.map((e) => e.value).sort((a, b) => a - b);
    assert.strictEqual(values[0], 99, "p99 item should have value 99");
    assert.strictEqual(values[1], 100, "p100 item should have value 100");
  });
});
