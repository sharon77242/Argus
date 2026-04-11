import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FsInstrumentation } from '../../src/instrumentation/fs.ts';

describe('FsInstrumentation', () => {
  it('should trace synchronous file operations', () => {
    const instrumentation = new FsInstrumentation(() => 'test.ts:1');
    let capturedOp: any = null;

    instrumentation.on('fs', (op) => {
      capturedOp = op;
    });

    instrumentation.enable();

    // Perform an operation that should be caught
    const tmpFile = path.join(process.cwd(), 'temp-fs-test.txt');
    try {
      fs.writeFileSync(tmpFile, 'hello');
      
      assert.ok(capturedOp, 'Should have captured writeFileSync');
      assert.strictEqual(capturedOp.method, 'writeFileSync');
      // Should have generated a critical suggestion because it's synchronous
      assert.ok(capturedOp.suggestions);
      assert.strictEqual(capturedOp.suggestions[0].rule, 'synchronous-fs');

      // Do a read
      capturedOp = null;
      fs.readFileSync(tmpFile);
      assert.ok(capturedOp, 'Should have captured readFileSync');
      assert.strictEqual(capturedOp.method, 'readFileSync');
    } finally {
      instrumentation.disable();
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  it('should restore prototypes on disable', () => {
    const instrumentation = new FsInstrumentation(() => undefined);
    const originalWrite = fs.writeFileSync;
    instrumentation.enable();
    assert.notStrictEqual(fs.writeFileSync, originalWrite);
    instrumentation.disable();
    assert.strictEqual(fs.writeFileSync, originalWrite);
  });
});
