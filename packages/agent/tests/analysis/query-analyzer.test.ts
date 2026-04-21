import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { QueryAnalyzer } from "../../src/analysis/query-analyzer.ts";

describe("QueryAnalyzer", () => {
  let analyzer: QueryAnalyzer;

  beforeEach(() => {
    analyzer = new QueryAnalyzer();
  });

  it("should flag SELECT * as a warning", () => {
    const suggestions = analyzer.analyze("SELECT * FROM users");
    const rule = suggestions.find((s) => s.rule === "no-select-star");
    assert.ok(rule, "Should detect SELECT *");
    assert.strictEqual(rule.severity, "warning");
  });

  it("should flag SELECT without LIMIT", () => {
    const suggestions = analyzer.analyze("SELECT `id`, `name` FROM users WHERE `id` = ?");
    const rule = suggestions.find((s) => s.rule === "missing-limit");
    assert.ok(rule, "Should detect missing LIMIT");
    assert.strictEqual(rule.severity, "info");
  });

  it("should NOT flag SELECT with LIMIT", () => {
    const suggestions = analyzer.analyze("SELECT * FROM users LIMIT 10");
    const rule = suggestions.find((s) => s.rule === "missing-limit");
    assert.strictEqual(rule, undefined, "Should not flag when LIMIT exists");
  });

  it("should flag UPDATE without WHERE as critical", () => {
    const suggestions = analyzer.analyze("UPDATE users SET `status` = ?");
    const rule = suggestions.find((s) => s.rule === "missing-where-update");
    assert.ok(rule, "Should detect UPDATE without WHERE");
    assert.strictEqual(rule.severity, "critical");
  });

  it("should flag DELETE without WHERE as critical", () => {
    const suggestions = analyzer.analyze("DELETE FROM sessions");
    const rule = suggestions.find((s) => s.rule === "missing-where-delete");
    assert.ok(rule, "Should detect DELETE without WHERE");
    assert.strictEqual(rule.severity, "critical");
  });

  it("should NOT flag UPDATE with WHERE", () => {
    const suggestions = analyzer.analyze("UPDATE users SET `status` = ? WHERE `id` = ?");
    const rule = suggestions.find((s) => s.rule === "missing-where-update");
    assert.strictEqual(rule, undefined);
  });

  it("should detect N+1 query pattern on repeated calls", () => {
    const query = "SELECT * FROM orders WHERE `user_id` = ?";

    // Fire the same query pattern rapidly
    for (let i = 0; i < 4; i++) {
      const s = analyzer.analyze(query);
      assert.ok(!s.find((x) => x.rule === "n-plus-one"), `Should not trigger at call ${i + 1}`);
    }

    // 5th call should trigger the N+1 warning
    const suggestions = analyzer.analyze(query);
    const rule = suggestions.find((s) => s.rule === "n-plus-one");
    assert.ok(rule, "Should detect N+1 on 5th repeated query");
    assert.strictEqual(rule.severity, "warning");
  });

  it("should flag full table scan (SELECT without WHERE or LIMIT)", () => {
    const suggestions = analyzer.analyze("SELECT `id` FROM large_table");
    const rule = suggestions.find((s) => s.rule === "full-table-scan");
    assert.ok(rule, "Should detect full table scan");
  });

  it("should return no suggestions for a well-formed query", () => {
    const suggestions = analyzer.analyze(
      "SELECT `id`, `name` FROM users WHERE `active` = ? LIMIT 50",
    );
    // Should have no warnings or critical issues
    const serious = suggestions.filter((s) => s.severity !== "info" && s.rule !== "n-plus-one");
    assert.strictEqual(serious.length, 0, "Well-formed query should have no serious issues");
  });

  // Bug: normalization only collapsed '?' — PostgreSQL $N and :name params were not normalized,
  // so structurally identical pg queries were treated as distinct and N+1 was never detected.
  it("should detect N+1 for PostgreSQL $N placeholder style", () => {
    const pgAnalyzer = new QueryAnalyzer();
    // Each call uses a different parameter number but the same structural query
    for (let i = 1; i <= 4; i++) {
      const s = pgAnalyzer.analyze(`SELECT id, name FROM users WHERE id = $${i}`);
      assert.ok(!s.find((x) => x.rule === "n-plus-one"), `Should not trigger at call ${i}`);
    }
    const suggestions = pgAnalyzer.analyze("SELECT id, name FROM users WHERE id = $5");
    const rule = suggestions.find((s) => s.rule === "n-plus-one");
    assert.ok(rule, "Should detect N+1 for PostgreSQL $N style params");
  });

  it("should detect N+1 for named :param placeholder style", () => {
    const namedAnalyzer = new QueryAnalyzer();
    for (let i = 1; i <= 4; i++) {
      namedAnalyzer.analyze(`SELECT * FROM orders WHERE user_id = :userId${i} LIMIT 10`);
    }
    const suggestions = namedAnalyzer.analyze(
      "SELECT * FROM orders WHERE user_id = :userId5 LIMIT 10",
    );
    const rule = suggestions.find((s) => s.rule === "n-plus-one");
    assert.ok(rule, "Should detect N+1 for named :param style params");
  });
});
