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
