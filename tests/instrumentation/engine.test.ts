import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import diagnostics_channel from "node:diagnostics_channel";
import { InstrumentationEngine, type TracedQuery } from "../../src/instrumentation/engine.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InstrumentationEngine", () => {
  let engine: InstrumentationEngine;

  beforeEach(() => {
    engine = new InstrumentationEngine();
  });

  afterEach(() => {
    engine.disable();
  });

  it("should sanitize SQL queries by substituting inline parameters", () => {
    const query1 = "SELECT * FROM users WHERE email = 'test@example.com' AND age > 25";
    const sanitized1 = engine.sanitizeQuery(query1);
    assert.strictEqual(sanitized1, "SELECT * FROM `users` WHERE `email` = ? AND `age` > ?");

    const query2 = 'UPDATE products SET price = 99.99, status = "SALE" WHERE id = 101';
    const sanitized2 = engine.sanitizeQuery(query2);
    assert.strictEqual(sanitized2, "UPDATE `products` SET `price` = ?, `status` = ? WHERE `id` = ?");
  });

  it("should capture and process diagnostics_channel messages", async () => {
    engine.enable();

    const p = once(engine, "query");

    const channel = diagnostics_channel.channel("db.query.execution");

    // Broadcast the synthetic DB trace
    channel.publish({ query: "SELECT * FROM secrets WHERE id = 1", durationMs: 15 });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 1000),
    );
    const [event] = (await Promise.race([p, timeoutPromise])) as [TracedQuery];

    assert.strictEqual(event.sanitizedQuery, "SELECT * FROM `secrets` WHERE `id` = ?");
    assert.strictEqual(event.durationMs, 15);
  });

  it("should manually wrap functions and trace correctly with accurate source location", async () => {
    const p = once(engine, "query");

    const result = await engine.traceQuery("DELETE FROM table WHERE x = 42", async () => {
      await sleep(20);
      return "ok";
    });

    assert.strictEqual(result, "ok");

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 1000),
    );
    const [event] = (await Promise.race([p, timeoutPromise])) as [TracedQuery];

    assert.strictEqual(event.sanitizedQuery, "DELETE FROM table WHERE x = ?");
    assert.ok(event.durationMs >= 20);

    // Verify the source line is from this file
    assert.ok(
      event.sourceLine && event.sourceLine.includes("engine.test.ts"),
      "Source line should point to the test file explicitly",
    );
  });
});
