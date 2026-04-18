import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FsInstrumentation, type TracedFsOperation } from "../../src/instrumentation/fs.ts";

describe("FsInstrumentation", () => {
  it("should trace synchronous file operations", () => {
    const instrumentation = new FsInstrumentation(() => "test.ts:1");
    const ops: TracedFsOperation[] = [];

    instrumentation.on("fs", (op: TracedFsOperation) => {
      ops.push(op);
    });

    instrumentation.enable();

    // Perform an operation that should be caught
    const tmpFile = path.join(process.cwd(), "temp-fs-test.txt");
    try {
      fs.writeFileSync(tmpFile, "hello");

      assert.ok(ops.length > 0, "Should have captured writeFileSync");
      assert.strictEqual(ops[0].method, "writeFileSync");
      // Should have generated a critical suggestion because it's synchronous
      assert.ok(ops[0].suggestions);
      assert.strictEqual(ops[0].suggestions[0].rule, "synchronous-fs");

      // Do a read
      ops.length = 0;
      fs.readFileSync(tmpFile);
      assert.ok(ops.length > 0, "Should have captured readFileSync");
      assert.strictEqual(ops[0].method, "readFileSync");
    } finally {
      instrumentation.disable();
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  it("should restore prototypes on disable", () => {
    const instrumentation = new FsInstrumentation(() => undefined);
    const originalWrite = fs.writeFileSync;
    instrumentation.enable();
    assert.notStrictEqual(fs.writeFileSync, originalWrite);
    instrumentation.disable();
    assert.strictEqual(fs.writeFileSync, originalWrite);
  });
});
