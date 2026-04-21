import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LogAnalyzer } from "../../src/analysis/log-analyzer.ts";

describe("LogAnalyzer", () => {
  const analyzer = new LogAnalyzer();

  it("should flag unstructured mixing of strings and objects", () => {
    const suggestions = analyzer.analyze(["User data:", { id: 1, name: "Alice" }]);
    const rule = suggestions.find((s) => s.rule === "unstructured-log");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "info");
  });

  it("should flag extremely large log payloads", () => {
    const hugeArray = new Array(1000).fill({
      a: "loooooooooooooong string here to make payload big",
    });
    const suggestions = analyzer.analyze([hugeArray]);
    const rule = suggestions.find((s) => s.rule === "large-log-payload");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "warning");
  });

  it("should flag an error storm if too many errors are logged rapidly", () => {
    analyzer.analyze(["Boom"], "error");
    analyzer.analyze(["Boom"], "error");
    analyzer.analyze(["Boom"], "error");
    analyzer.analyze(["Boom"], "error");
    const suggestions = analyzer.analyze(["Boom"], "error");

    const rule = suggestions.find((s) => s.rule === "log-error-storm");
    assert.ok(rule);
    assert.strictEqual(rule.severity, "critical");
  });

  it("should pass normal structured or string logs", () => {
    const s1 = analyzer.analyze(["A simple log"]);
    const s2 = analyzer.analyze([{ some: "object entirely" }]);
    assert.strictEqual(s1.length, 0);
    assert.strictEqual(s2.length, 0);
  });

  // Bug: threshold check used === so warning fired only on exactly the 5th error and never again
  it("should keep warning on every error beyond the threshold (>= not ===)", () => {
    const fresh = new LogAnalyzer();
    // Reach threshold
    for (let i = 0; i < 5; i++) fresh.analyze(["err"], "error");
    // 6th error must also trigger the storm warning
    const suggestions = fresh.analyze(["err"], "error");
    const rule = suggestions.find((s) => s.rule === "log-error-storm");
    assert.ok(rule, "log-error-storm should still fire on the 6th error in the window");
  });
});
