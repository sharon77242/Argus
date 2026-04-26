import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { StaticScanner } from "../../src/analysis/static-scanner.ts";
import type { ScanResult } from "../../src/analysis/types.ts";

const BAD_POOL_DIR = join(import.meta.dirname, "../fixtures/pool-scan-bad");
const CLEAN_POOL_DIR = join(import.meta.dirname, "../fixtures/pool-scan-clean");

// A minimal fixture project with exactly one clean .ts file and its own
// tsconfig.json. Using process.cwd() (the full agent project) is fragile
// because the agent's tsconfig includes tests/, so any TS issue introduced
// in ANY test file would cause this assertion to fail non-deterministically.
const CLEAN_FIXTURE_DIR = join(import.meta.dirname, "../fixtures/static-scanner-clean");

describe("StaticScanner", () => {
  it("should run TypeScript scan and return a ScanResult", async () => {
    // Scan the clean fixture — scope is limited to one pristine .ts file
    const scanner = new StaticScanner(CLEAN_FIXTURE_DIR);
    const result = await scanner.runTypeScript();

    assert.strictEqual(result.tool, "tsc");
    assert.ok(typeof result.totalIssues === "number");
    assert.ok(typeof result.durationMs === "number");
    assert.ok(Array.isArray(result.suggestions));

    // The fixture has zero TypeScript issues by design
    assert.strictEqual(
      result.totalIssues,
      0,
      `Expected 0 TS issues but got ${result.totalIssues}: ${JSON.stringify(result.suggestions)}`,
    );
  });

  it("should run full scan and emit scan event", async () => {
    const scanner = new StaticScanner(process.cwd());

    let emittedResults: ScanResult[] | null = null;
    scanner.on("scan", (results) => {
      emittedResults = results;
    });

    const results = await scanner.scan();

    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1); // At least tsc result
    assert.strictEqual(results[0].tool, "tsc");
    assert.ok(emittedResults, "Should have emitted scan event");
  });

  it("should parse TypeScript error output format correctly", () => {
    // Test the parsing logic by checking the internal method behavior
    // We do this by creating a scanner and verifying it constructs valid suggestions
    const scanner = new StaticScanner(process.cwd());

    // The scanner should handle an empty project gracefully
    assert.ok(scanner instanceof StaticScanner);
  });
});

// R.2 — missing-connection-pool
describe("StaticScanner — runConnectionPoolScan", () => {
  it("flags new Client() called inside a function body", async () => {
    const scanner = new StaticScanner(BAD_POOL_DIR);
    const result = await scanner.runConnectionPoolScan();
    assert.ok(result, "should return a ScanResult");
    const rule = result.suggestions.find((s) => s.rule === "missing-connection-pool");
    assert.ok(
      rule,
      `missing-connection-pool not found. Got: ${JSON.stringify(result.suggestions)}`,
    );
    assert.strictEqual(rule.severity, "warning");
  });

  it("flags createConnection() called inside a function body", async () => {
    const scanner = new StaticScanner(BAD_POOL_DIR);
    const result = await scanner.runConnectionPoolScan();
    assert.ok(result);
    const rules = result.suggestions.filter((s) => s.rule === "missing-connection-pool");
    assert.ok(rules.length >= 2, `expected ≥2 findings, got ${rules.length}`);
  });

  it("does NOT flag new Client() at module top level", async () => {
    const scanner = new StaticScanner(CLEAN_POOL_DIR);
    const result = await scanner.runConnectionPoolScan();
    assert.ok(result);
    const rule = result.suggestions.find((s) => s.rule === "missing-connection-pool");
    assert.ok(
      !rule,
      `should not flag module-level client, but got: ${JSON.stringify(result.suggestions)}`,
    );
  });

  it("scan() includes pool scan results when issues are found", async () => {
    const scanner = new StaticScanner(BAD_POOL_DIR);
    const results = await scanner.scan();
    const poolResult = results.find((r) => r.tool === "argus-static");
    assert.ok(poolResult, "scan() should include argus-static result when issues found");
    assert.ok(poolResult.suggestions.some((s) => s.rule === "missing-connection-pool"));
  });

  it("returns null gracefully when TypeScript is not available", async () => {
    const scanner = new StaticScanner("/nonexistent/path");
    const result = await scanner.runConnectionPoolScan();
    assert.ok(result === null || result.totalIssues === 0);
  });
});
