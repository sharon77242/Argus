import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FsAnalyzer } from "../../src/analysis/fs-analyzer.ts";

describe("FsAnalyzer", () => {
  const analyzer = new FsAnalyzer();

  it("should flag *Sync methods as critical Event Loop blockers", () => {
    const suggestions = analyzer.analyze("readFileSync", "/tmp/file.txt");
    const rule = suggestions.find((s) => s.rule === "synchronous-fs");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "critical");
  });

  it("should flag path traversal patterns", () => {
    const suggestions = analyzer.analyze("readFile", "../../etc/passwd");
    const rule = suggestions.find((s) => s.rule === "path-traversal-risk");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "warning");
  });

  it("should flag accesses to critical system files", () => {
    const suggestions = analyzer.analyze("readFile", "/etc/shadow");
    const rule = suggestions.find((s) => s.rule === "sensitive-file-access");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "critical");
  });

  it("should flag repeated identical file reads as a missing cache opportunity", () => {
    // 5 hits to the same file should trigger
    analyzer.analyze("readFileSync", "/etc/config.json");
    analyzer.analyze("readFileSync", "/etc/config.json");
    analyzer.analyze("readFileSync", "/etc/config.json");
    analyzer.analyze("readFileSync", "/etc/config.json");
    const suggestions = analyzer.analyze("readFileSync", "/etc/config.json");

    const rule = suggestions.find((s) => s.rule === "missing-fs-cache");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "warning");
  });

  it("should pass normal async file operations", () => {
    const suggestions = analyzer.analyze("readFile", "/var/log/app.log");
    assert.strictEqual(suggestions.length, 0);
  });

  // Bug: threshold check used === so warning fired on exactly the 5th read and never again
  it("should keep warning on reads beyond the threshold (>= not ===)", () => {
    const fresh = new FsAnalyzer();
    const path = "/data/keeps-firing.json";
    for (let i = 0; i < 5; i++) fresh.analyze("readFile", path);
    // 6th read must also produce the warning
    const suggestions = fresh.analyze("readFile", path);
    const rule = suggestions.find((s) => s.rule === "missing-fs-cache");
    assert.ok(rule, "missing-fs-cache should still fire on the 6th read");
  });

  // Bug: when recentReads.size > 100 the entire map was cleared, losing all tracking state
  it("should not lose tracking state when more than 100 unique paths are active", () => {
    const fresh = new FsAnalyzer();
    // Fill the map with 100 unique paths
    for (let i = 0; i < 100; i++) fresh.analyze("readFile", `/unique/path/${i}.json`);
    // Now analyse a path 4 times (below threshold) — state must survive the eviction check
    const target = "/data/tracked.json";
    for (let i = 0; i < 4; i++) fresh.analyze("readFile", target);
    // 5th read triggers the threshold — must still fire despite size > 100
    const suggestions = fresh.analyze("readFile", target);
    const rule = suggestions.find((s) => s.rule === "missing-fs-cache");
    assert.ok(rule, "tracking state must survive when map has >100 entries");
  });
});
