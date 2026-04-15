import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AstSanitizer } from "../../src/sanitization/ast-sanitizer.ts";

describe("AstSanitizer", () => {
  it("should sanitize basic values via AST replacement", () => {
    const sanitizer = new AstSanitizer();
    const query = "SELECT * FROM users WHERE email = 'test@example.com' AND age > 25";
    const sanitized = sanitizer.stripSql(query);
    assert.strictEqual(sanitized, "SELECT * FROM `users` WHERE `email` = ? AND `age` > ?");
  });

  it("should handle UPDATE logic with quotes appropriately", () => {
    const sanitizer = new AstSanitizer();
    const query = "UPDATE products SET price = 99.99, status = 'SALE' WHERE id = 101";
    const sanitized = sanitizer.stripSql(query);
    assert.strictEqual(sanitized, "UPDATE `products` SET `price` = ?, `status` = ? WHERE `id` = ?");
  });
});

describe("AstSanitizer.sanitizeDocument", () => {
  const s = new AstSanitizer();

  it("replaces primitive leaf values with '?'", () => {
    const result = s.sanitizeDocument({ name: "alice", age: 30, active: true });
    assert.deepStrictEqual(result, { name: "?", age: "?", active: "?" });
  });

  it("preserves nested object structure", () => {
    const result = s.sanitizeDocument({ user: { id: 1, email: "a@b.com" } });
    assert.deepStrictEqual(result, { user: { id: "?", email: "?" } });
  });

  it("preserves operator keys (starting with $) and replaces their primitive values", () => {
    const result = s.sanitizeDocument({ age: { $gt: 18, $lt: 65 } });
    assert.deepStrictEqual(result, { age: { $gt: 18, $lt: 65 } });
  });

  it("replaces values under non-operator keys even when nested under operators", () => {
    // { $and: [{ status: 'active' }] } → { $and: [{ status: '?' }] }
    const result = s.sanitizeDocument({ $and: [{ status: "active" }] });
    assert.deepStrictEqual(result, { $and: [{ status: "?" }] });
  });

  it("sanitizes arrays by sanitizing each element", () => {
    const result = s.sanitizeDocument([{ id: 1 }, { id: 2 }]);
    assert.deepStrictEqual(result, [{ id: "?" }, { id: "?" }]);
  });

  it("returns '?' for a bare primitive at the top level", () => {
    assert.strictEqual(s.sanitizeDocument("secret"), "?");
    assert.strictEqual(s.sanitizeDocument(42), "?");
  });

  it("does not mutate the original document", () => {
    const original = { user: { email: "test@example.com" } };
    s.sanitizeDocument(original);
    assert.strictEqual(original.user.email, "test@example.com");
  });

  it("handles null values in document", () => {
    const result = s.sanitizeDocument({ field: null, nested: { x: null } });
    assert.deepStrictEqual(result, { field: "?", nested: { x: "?" } });
  });
});
