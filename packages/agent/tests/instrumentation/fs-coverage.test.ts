/**
 * Additional coverage tests for FsInstrumentation
 * Targets: async (callback-style) fs operations (lines 63-68), enable() try/catch (lines 49-51),
 *          disable() try/catch (line 104), double-enable idempotency
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FsInstrumentation, type TracedFsOperation } from '../../src/instrumentation/fs.ts';

describe('FsInstrumentation (coverage)', () => {

  // ── Async callback-style fs operation ─────────────────────────────────────
  it('should trace async (callback-style) file writes', (_, done) => {
    const instr = new FsInstrumentation(() => 'source.ts:1');
    const events: TracedFsOperation[] = [];
    instr.on('fs', (op) => events.push(op));
    instr.enable();

    const tmpFile = path.join(os.tmpdir(), `fs-cb-test-${Date.now()}.txt`);
    try {
      fs.writeFile(tmpFile, 'callback data', (err) => {
        // Restore fs before calling done to avoid polluting other tests
        instr.disable();

        try {
          fs.unlinkSync(tmpFile);
        } catch {}

        assert.strictEqual(err, null, 'writeFile should not error');
        // The callback wrapper should have emitted an 'fs' event
        assert.strictEqual(events.length, 1, 'Should have captured one async fs event');
        assert.strictEqual(events[0].method, 'writeFile');
        assert.ok(typeof events[0].durationMs === 'number');
        done();
      });
    } catch (e) {
      instr.disable();
      done(e);
    }
  });

  // ── enable() is idempotent ───────────────────────────────────────────────
  it('enable() should be a no-op on the second call', () => {
    const instr = new FsInstrumentation(() => undefined);
    instr.enable();
    const patchCountBefore = (instr as any).originalMethods.size;
    instr.enable(); // second call
    const patchCountAfter = (instr as any).originalMethods.size;
    assert.strictEqual(patchCountAfter, patchCountBefore, 'Should not re-patch on second enable()');
    instr.disable();
  });

  // ── disable() is idempotent ───────────────────────────────────────────────
  it('disable() should be safe to call when not active', () => {
    const instr = new FsInstrumentation(() => undefined);
    assert.doesNotThrow(() => {
      instr.disable();
      instr.disable();
    });
  });

  // ── args[0] is a non-string (e.g., Buffer path) ──────────────────────────
  it('should handle non-string path arguments gracefully', (_, done) => {
    const instr = new FsInstrumentation(() => undefined);
    const events: TracedFsOperation[] = [];
    instr.on('fs', (op) => events.push(op));
    instr.enable();

    const tmpFile = path.join(os.tmpdir(), `fs-buf-test-${Date.now()}.txt`);
    // Use a URL object as the path (triggers toString() fallback in the patch)
    const urlPath = new URL(`file://${tmpFile.replace(/\\/g, '/')}`);

    try {
      fs.writeFile(urlPath, 'url path test', (err) => {
        instr.disable();
        try {
          fs.unlinkSync(tmpFile);
        } catch {}

        // We don't assert on the event content, just that it didn't crash
        done(err ?? undefined);
      });
    } catch (e) {
      instr.disable();
      done(e);
    }
  });

  // ── enable() try/catch: graceful when fs is sealed/restricted (lines 49-51) ─
  it('enable() should not throw when fs method patching fails', () => {
    const instr = new FsInstrumentation(() => undefined);

    // Simulate a sealed environment where writing to fs[method] throws
    const originalWriteFileSync = (fs as any).writeFileSync;
    Object.defineProperty(fs, 'writeFileSync', {
      get: () => originalWriteFileSync,
      set: () => { throw new TypeError('Cannot assign to read only property'); },
      configurable: true,
    });

    try {
      // enable() should catch the error and not throw
      assert.doesNotThrow(() => instr.enable());
    } finally {
      // Restore the original property
      Object.defineProperty(fs, 'writeFileSync', {
        value: originalWriteFileSync,
        writable: true,
        configurable: true,
      });
    }
  });
});
