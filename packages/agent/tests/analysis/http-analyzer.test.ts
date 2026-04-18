import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpAnalyzer } from "../../src/analysis/http-analyzer.ts";

describe("HttpAnalyzer", () => {
  const analyzer = new HttpAnalyzer();

  it("should flag insecure http:// requests to non-localhost", () => {
    const suggestions = analyzer.analyze("GET", "http://api.weather.com/data", 100);
    const rule = suggestions.find((s) => s.rule === "insecure-http");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "critical");
  });

  it("should NOT flag insecure http:// requests to localhost", () => {
    const suggestions = analyzer.analyze("GET", "http://localhost:3000/data", 100);
    const rule = suggestions.find((s) => s.rule === "insecure-http");
    assert.strictEqual(rule, undefined);
  });

  it("should flag slow requests > 2000ms", () => {
    const suggestions = analyzer.analyze("POST", "https://api.stripe.com/charge", 2500);
    const rule = suggestions.find((s) => s.rule === "slow-http-request");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "warning");
  });

  it("should flag server error 500s", () => {
    const suggestions = analyzer.analyze("GET", "https://api.github.com", 150, 503);
    const rule = suggestions.find((s) => s.rule === "http-server-error");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "critical");
  });

  it("should flag rate limiting 429s", () => {
    const suggestions = analyzer.analyze("POST", "https://api.github.com", 150, 429);
    const rule = suggestions.find((s) => s.rule === "http-rate-limited");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "warning");
  });

  it("should return empty for fast, secure requests", () => {
    const suggestions = analyzer.analyze("GET", "https://api.github.com/v3", 150, 200);
    assert.strictEqual(suggestions.length, 0);
  });
});
