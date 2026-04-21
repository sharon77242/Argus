import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AdaptiveSampler } from "../../src/instrumentation/adaptive-sampler.ts";

describe("AdaptiveSampler", () => {
  // ── initial state ─────────────────────────────────────────────────────────

  it("getTokens returns burst capacity for a new category", () => {
    const sampler = new AdaptiveSampler({ burst: 5 });
    assert.strictEqual(sampler.getTokens("query"), 5);
  });

  it("shouldSample returns true for first call (bucket starts full)", () => {
    const sampler = new AdaptiveSampler({ burst: 5 });
    assert.strictEqual(sampler.shouldSample("query"), true);
  });

  // ── token consumption ─────────────────────────────────────────────────────

  it("consumes one token per shouldSample(true) call", () => {
    const sampler = new AdaptiveSampler({ burst: 3, ratePerMs: 0 }); // no refill
    assert.strictEqual(sampler.shouldSample("q"), true); // 3→2
    assert.strictEqual(sampler.shouldSample("q"), true); // 2→1
    assert.strictEqual(sampler.shouldSample("q"), true); // 1→0
    assert.strictEqual(sampler.shouldSample("q"), false); // 0 → drop
  });

  it("different categories have independent buckets", () => {
    const sampler = new AdaptiveSampler({ burst: 1, ratePerMs: 0 });
    sampler.shouldSample("query"); // drains 'query' bucket
    // 'http' bucket is still full
    assert.strictEqual(sampler.shouldSample("http"), true);
    assert.strictEqual(sampler.shouldSample("http"), false);
  });

  // ── refill ────────────────────────────────────────────────────────────────

  it("tokens refill over time", async () => {
    // ratePerMs = 1 token/ms, burst = 10 → drain then wait for refill
    const sampler = new AdaptiveSampler({ ratePerMs: 1, burst: 10 });
    for (let i = 0; i < 10; i++) sampler.shouldSample("test");
    // After 20ms at 1/ms the bucket must have refilled (capped at burst=10)
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(sampler.shouldSample("test"), true);
  });

  it("tokens do not exceed burst capacity", async () => {
    const sampler = new AdaptiveSampler({ ratePerMs: 100, burst: 5 });
    // Wait a long time — tokens should be capped at burst=5
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(sampler.getTokens("x") <= 5);
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it("reset(category) refills that category to full", () => {
    const sampler = new AdaptiveSampler({ burst: 3, ratePerMs: 0 });
    sampler.shouldSample("q");
    sampler.shouldSample("q");
    sampler.shouldSample("q"); // drain
    sampler.reset("q");
    assert.strictEqual(sampler.shouldSample("q"), true);
  });

  it("reset() with no arg clears all buckets", () => {
    const sampler = new AdaptiveSampler({ burst: 1, ratePerMs: 0 });
    sampler.shouldSample("a");
    sampler.shouldSample("b");
    sampler.reset();
    assert.strictEqual(sampler.shouldSample("a"), true);
    assert.strictEqual(sampler.shouldSample("b"), true);
  });

  it("reset(category) does not affect other categories", () => {
    const sampler = new AdaptiveSampler({ burst: 1, ratePerMs: 0 });
    sampler.shouldSample("a"); // drain a
    sampler.shouldSample("b"); // drain b
    sampler.reset("a");
    assert.strictEqual(sampler.shouldSample("a"), true); // refilled
    assert.strictEqual(sampler.shouldSample("b"), false); // still drained
  });
});
