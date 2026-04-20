import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  TransactionMonitor,
  type TransactionEvent,
} from "../../src/analysis/transaction-monitor.ts";
import type { TracedQuery } from "../../src/instrumentation/engine.ts";

function makeQuery(overrides: Partial<TracedQuery> = {}): TracedQuery {
  return {
    sanitizedQuery: "SELECT ?",
    durationMs: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("TransactionMonitor", () => {
  let monitor: TransactionMonitor;

  afterEach(() => {
    monitor.stop();
  });

  // ── lifecycle ─────────────────────────────────────────────────────────────

  it("openCount starts at 0", () => {
    monitor = new TransactionMonitor();
    assert.strictEqual(monitor.openCount, 0);
  });

  it("stop() is safe to call before attach()", () => {
    monitor = new TransactionMonitor();
    assert.doesNotThrow(() => monitor.stop());
  });

  it("detach() on unattached source is a no-op", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    assert.doesNotThrow(() => monitor.detach(src));
  });

  it("attach() is idempotent — attaching same source twice is a no-op", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);
    monitor.attach(src); // second call must not double-register
    src.emit("query", makeQuery({ sanitizedQuery: "BEGIN" }));
    assert.strictEqual(monitor.openCount, 1);
  });

  // ── transaction detection ─────────────────────────────────────────────────

  it("fires 'transaction' event on COMMIT", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);

    const events: TransactionEvent[] = [];
    monitor.on("transaction", (e) => events.push(e));

    src.emit("query", makeQuery({ sanitizedQuery: "BEGIN", traceId: "abc" }));
    src.emit("query", makeQuery({ sanitizedQuery: "SELECT ?", traceId: "abc" }));
    src.emit("query", makeQuery({ sanitizedQuery: "COMMIT", traceId: "abc" }));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].queryCount, 1);
    assert.strictEqual(events[0].aborted, false);
    assert.strictEqual(events[0].traceId, "abc");
  });

  it("fires 'transaction' event on ROLLBACK with aborted=true", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);

    const events: TransactionEvent[] = [];
    monitor.on("transaction", (e) => events.push(e));

    src.emit("query", makeQuery({ sanitizedQuery: "BEGIN", traceId: "txn1" }));
    src.emit("query", makeQuery({ sanitizedQuery: "ROLLBACK", traceId: "txn1" }));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].aborted, true);
    assert.strictEqual(events[0].queryCount, 0);
  });

  it("counts intermediate queries correctly", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);

    const events: TransactionEvent[] = [];
    monitor.on("transaction", (e) => events.push(e));

    src.emit("query", makeQuery({ sanitizedQuery: "BEGIN", traceId: "t1" }));
    src.emit("query", makeQuery({ sanitizedQuery: "INSERT INTO users", traceId: "t1" }));
    src.emit("query", makeQuery({ sanitizedQuery: "UPDATE accounts", traceId: "t1" }));
    src.emit("query", makeQuery({ sanitizedQuery: "COMMIT", traceId: "t1" }));

    assert.strictEqual(events[0].queryCount, 2);
  });

  it("does not fire if COMMIT has no matching BEGIN", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);

    const events: TransactionEvent[] = [];
    monitor.on("transaction", (e) => events.push(e));

    src.emit("query", makeQuery({ sanitizedQuery: "COMMIT", traceId: "orphan" }));
    assert.strictEqual(events.length, 0);
  });

  it("isolates concurrent transactions by traceId", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);

    const events: TransactionEvent[] = [];
    monitor.on("transaction", (e) => events.push(e));

    src.emit("query", makeQuery({ sanitizedQuery: "BEGIN", traceId: "t1" }));
    src.emit("query", makeQuery({ sanitizedQuery: "BEGIN", traceId: "t2" }));
    src.emit("query", makeQuery({ sanitizedQuery: "COMMIT", traceId: "t1" }));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].traceId, "t1");
    assert.strictEqual(monitor.openCount, 1); // t2 still open
  });

  it("falls back to correlationId when traceId absent", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);

    const events: TransactionEvent[] = [];
    monitor.on("transaction", (e) => events.push(e));

    src.emit("query", makeQuery({ sanitizedQuery: "BEGIN", correlationId: "req-1" }));
    src.emit("query", makeQuery({ sanitizedQuery: "COMMIT", correlationId: "req-1" }));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].correlationId, "req-1");
  });

  it("event carries durationMs and timestamp fields", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);

    const events: TransactionEvent[] = [];
    monitor.on("transaction", (e) => events.push(e));

    src.emit("query", makeQuery({ sanitizedQuery: "BEGIN", traceId: "t9" }));
    src.emit("query", makeQuery({ sanitizedQuery: "COMMIT", traceId: "t9" }));

    assert.ok("durationMs" in events[0]);
    assert.ok("timestamp" in events[0]);
    assert.ok(events[0].timestamp <= Date.now());
  });

  it("is case-insensitive: 'begin' / 'commit' / 'rollback' all match", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);

    const events: TransactionEvent[] = [];
    monitor.on("transaction", (e) => events.push(e));

    src.emit("query", makeQuery({ sanitizedQuery: "  begin  ", traceId: "ci" }));
    src.emit("query", makeQuery({ sanitizedQuery: "  commit  ", traceId: "ci" }));

    assert.strictEqual(events.length, 1);
  });

  it("detach() stops receiving events from that source", () => {
    monitor = new TransactionMonitor();
    const src = new EventEmitter();
    monitor.attach(src);

    const events: TransactionEvent[] = [];
    monitor.on("transaction", (e) => events.push(e));

    monitor.detach(src);

    src.emit("query", makeQuery({ sanitizedQuery: "BEGIN", traceId: "detached" }));
    src.emit("query", makeQuery({ sanitizedQuery: "COMMIT", traceId: "detached" }));

    assert.strictEqual(events.length, 0);
  });
});
