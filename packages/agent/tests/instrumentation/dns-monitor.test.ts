import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DnsMonitor, type DnsEvent } from "../../src/instrumentation/dns-monitor.ts";

describe("DnsMonitor", () => {
  let monitor: DnsMonitor;

  afterEach(() => {
    monitor.disable();
  });

  // ── lifecycle ─────────────────────────────────────────────────────────────

  it("isActive is false before enable()", () => {
    monitor = new DnsMonitor();
    assert.strictEqual(monitor.isActive, false);
  });

  it("enable() sets isActive true", () => {
    monitor = new DnsMonitor();
    monitor.enable();
    assert.strictEqual(monitor.isActive, true);
  });

  it("disable() sets isActive false", () => {
    monitor = new DnsMonitor();
    monitor.enable();
    monitor.disable();
    assert.strictEqual(monitor.isActive, false);
  });

  it("enable() is idempotent", () => {
    monitor = new DnsMonitor();
    monitor.enable();
    monitor.enable();
    assert.strictEqual(monitor.isActive, true);
  });

  it("disable() is idempotent", () => {
    monitor = new DnsMonitor();
    monitor.enable();
    monitor.disable();
    monitor.disable();
    assert.strictEqual(monitor.isActive, false);
  });

  // ── _injectDns test helper ────────────────────────────────────────────────

  it("fires 'dns' event on every inject", () => {
    monitor = new DnsMonitor({ slowThresholdMs: 200 });
    const events: DnsEvent[] = [];
    monitor.on("dns", (e) => events.push(e));

    monitor._injectDns("example.com", 10);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].hostname, "example.com");
    assert.strictEqual(events[0].durationMs, 10);
  });

  it("fires 'slow-dns' when durationMs >= slowThresholdMs", () => {
    monitor = new DnsMonitor({ slowThresholdMs: 100 });
    const slowEvents: DnsEvent[] = [];
    monitor.on("slow-dns", (e) => slowEvents.push(e));

    monitor._injectDns("slow.host", 150);
    assert.strictEqual(slowEvents.length, 1);
    assert.strictEqual(slowEvents[0].hostname, "slow.host");
  });

  it("does not fire 'slow-dns' below threshold", () => {
    monitor = new DnsMonitor({ slowThresholdMs: 100 });
    const slowEvents: DnsEvent[] = [];
    monitor.on("slow-dns", (e) => slowEvents.push(e));

    monitor._injectDns("fast.host", 50);
    assert.strictEqual(slowEvents.length, 0);
  });

  it("fires 'slow-dns' at exactly the threshold (>=)", () => {
    monitor = new DnsMonitor({ slowThresholdMs: 100 });
    const slowEvents: DnsEvent[] = [];
    monitor.on("slow-dns", (e) => slowEvents.push(e));

    monitor._injectDns("edge.host", 100); // exactly 100ms
    assert.strictEqual(slowEvents.length, 1);
  });

  it("event carries error field when provided", () => {
    monitor = new DnsMonitor();
    const events: DnsEvent[] = [];
    monitor.on("dns", (e) => events.push(e));

    monitor._injectDns("bad.host", 5, "ENOTFOUND");
    assert.strictEqual(events[0].error, "ENOTFOUND");
  });

  it("event carries addresses when provided", () => {
    monitor = new DnsMonitor();
    const events: DnsEvent[] = [];
    monitor.on("dns", (e) => events.push(e));

    monitor._injectDns("ok.host", 5, undefined, ["1.2.3.4"]);
    assert.deepStrictEqual(events[0].addresses, ["1.2.3.4"]);
  });

  it("event has timestamp", () => {
    monitor = new DnsMonitor();
    const events: DnsEvent[] = [];
    monitor.on("dns", (e) => events.push(e));

    monitor._injectDns("ts.host", 1);
    assert.ok(events[0].timestamp <= Date.now());
  });
});
