import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EntropyChecker } from "../../src/sanitization/entropy-checker.ts";

describe("EntropyChecker", () => {
  it("should calculate accurate zero entropy for uniform strings", () => {
    assert.strictEqual(EntropyChecker.calculateShannonEntropy("aaaaaaaaaaaaa"), 0);
  });

  it("should scrub high entropy JWTs and Bearer tokens", () => {
    // Mock JWT-like structure string
    const input =
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWJqZWN0IjoidXNlcjEyMyIsImFkbWluIjp0cnVlfQ.v_YxM7N6qxwHkRbJgBfZ1L9K3d8TmP5Cz-A";
    const scrubbed = EntropyChecker.scrubHighEntropyStrings(input);

    assert.ok(scrubbed.includes("[REDACTED_SECRET]"));
    assert.ok(!scrubbed.includes("eyJhbG"));
  });

  it("should leave normal sentences and logs completely intact", () => {
    // Despite being long, the alphabet distribution lowers the entropy
    const input =
      "This is exactly the type of normal sentence that we expect a monitoring engine to process without accidentally redacting standard console logs.";
    const scrubbed = EntropyChecker.scrubHighEntropyStrings(input);

    assert.strictEqual(scrubbed, input);
  });
});
