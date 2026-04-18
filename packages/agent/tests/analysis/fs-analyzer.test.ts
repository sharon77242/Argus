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
});
