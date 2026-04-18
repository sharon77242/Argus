import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LoggerInstrumentation, type TracedLog } from "../../src/instrumentation/logger.ts";

describe("LoggerInstrumentation", () => {
  it("should trace console logs and apply entropy scrubbing", () => {
    const instrumentation = new LoggerInstrumentation(() => "test.ts:1", {
      scrubContext: true,
      entropyThreshold: 2.0,
    });
    const logs: TracedLog[] = [];

    instrumentation.on("log", (log: TracedLog) => {
      logs.push(log);
    });

    instrumentation.enable();

    // Use console.log with a high-entropy string (JWT-like)
    const secret = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJs...";
    console.log("Testing entropy", secret);

    instrumentation.disable();

    assert.ok(logs.length > 0);
    assert.strictEqual(logs[0].level, "log");
    assert.strictEqual(logs[0].argsLength, 2);
    // Because we set threshold tight, it should have been scrubbed
    assert.ok(logs[0].scrubbed, "Should indicate scrubbing occurred");
  });

  it("should pass log structures to the analyzer", () => {
    const instrumentation = new LoggerInstrumentation(() => "test.ts:1");
    const logs: TracedLog[] = [];

    instrumentation.on("log", (log: TracedLog) => {
      logs.push(log);
    });

    instrumentation.enable();
    console.warn("String", { mix: true });
    instrumentation.disable();

    assert.ok(logs.length > 0);
    assert.strictEqual(logs[0].level, "warn");
    assert.ok(logs[0].suggestions);
    assert.strictEqual(logs[0].suggestions[0].rule, "unstructured-log");
  });
});
