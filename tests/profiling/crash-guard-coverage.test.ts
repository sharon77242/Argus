/**
 * Additional coverage tests for CrashGuard
 * Targets: unhandledRejection (lines 39-41), disable idempotency (line 29),
 *          handleCrash when NOT active (line 46), and process.exit path (lines 69-70)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrashGuard } from '../../src/profiling/crash-guard.ts';

describe('CrashGuard (coverage)', () => {

  it('should handle unhandledRejection with an Error object', async () => {
    process.env.NODE_ENV = 'test';
    const guard = new CrashGuard();
    let event: any = null;
    guard.on('crash', (e) => { event = e; });

    // Set active so handleCrash runs
    (guard as any).active = true;

    const testError = new Error('Promise blew up');
    (guard as any).handleUnhandledRejection(testError);

    assert.ok(event, 'Should have emitted crash event');
    assert.strictEqual(event.type, 'unhandledRejection');
    assert.strictEqual(event.error, testError);
    assert.ok(event.suggestions[0].message.includes('async Promise'));
  });

  it('should handle unhandledRejection with a non-Error reason', async () => {
    process.env.NODE_ENV = 'test';
    const guard = new CrashGuard();
    let event: any = null;
    guard.on('crash', (e) => { event = e; });

    (guard as any).active = true;

    // Pass a plain string as rejection reason
    (guard as any).handleUnhandledRejection('string rejection reason');

    assert.ok(event, 'Should have emitted crash event');
    assert.strictEqual(event.type, 'unhandledRejection');
    assert.ok(event.error instanceof Error, 'Should wrap string in Error');
    assert.ok(event.error.message.includes('string rejection reason'));
  });

  it('should no-op when handleCrash is called while inactive', () => {
    const guard = new CrashGuard();
    let event: any = null;
    guard.on('crash', (e) => { event = e; });

    // active = false (default)
    (guard as any).handleCrash('uncaughtException', new Error('ignored'));
    assert.strictEqual(event, null, 'Should not emit when inactive');
  });

  it('disable() should be idempotent (safe to call when already disabled)', () => {
    const guard = new CrashGuard();
    assert.doesNotThrow(() => {
      guard.disable(); // calling on already-disabled guard
      guard.disable();
    });
  });

  it('enable() followed by disable() should cleanly remove listeners', () => {
    process.env.NODE_ENV = 'test';
    const guard = new CrashGuard();

    guard.enable();
    assert.strictEqual((guard as any).active, true);

    guard.disable();
    assert.strictEqual((guard as any).active, false);
  });

  it('should NOT call process.exit in test mode (NODE_ENV=test)', (_, done) => {
    process.env.NODE_ENV = 'test';

    const guard = new CrashGuard();
    (guard as any).active = true;

    let exited = false;
    const originalExit = process.exit;
    (process as any).exit = () => { exited = true; };

    try {
      (guard as any).handleCrash('uncaughtException', new Error('test exit check'));
    } finally {
      // Restore after the setTimeout fires
      setTimeout(() => {
        (process as any).exit = originalExit;
        assert.strictEqual(exited, false, 'process.exit should NOT be called in test mode');
        done();
      }, 150);
    }
  });

  it('should resolve stack via custom resolver', () => {
    process.env.NODE_ENV = 'test';
    const guard = new CrashGuard(stack => `RESOLVED:${stack}`);
    let event: any = null;
    guard.on('crash', (e) => { event = e; });

    (guard as any).active = true;
    const err = new Error('mapped crash');
    (guard as any).handleCrash('uncaughtException', err);

    assert.ok(event.resolvedStack?.startsWith('RESOLVED:'));
  });

  it('should produce undefined resolvedStack when error has no stack', () => {
    process.env.NODE_ENV = 'test';
    const guard = new CrashGuard();
    let event: any = null;
    guard.on('crash', (e) => { event = e; });

    (guard as any).active = true;
    const err = new Error('no stack');
    delete err.stack; // remove the stack
    (guard as any).handleCrash('uncaughtException', err);

    assert.strictEqual(event.resolvedStack, undefined);
  });

  // ── handleUncaughtException arrow function body (line 36) ────────────────
  it('handleUncaughtException: should call handleCrash with the error', () => {
    process.env.NODE_ENV = 'test';
    const guard = new CrashGuard();
    let event: any = null;
    guard.on('crash', (e) => { event = e; });

    guard.enable(); // registers process listeners (sets active=true)

    // Invoke the private arrow function directly to hit line 36
    const testError = new Error('arrow fn crash');
    (guard as any).handleUncaughtException(testError);

    guard.disable();

    assert.ok(event, 'Should have emitted crash event');
    assert.strictEqual(event.type, 'uncaughtException');
    assert.strictEqual(event.error, testError);
  });

  // ── process.exit(1) in production mode (lines 69-70) ────────────────────
  it('should call process.exit(1) when NODE_ENV is not test', (_, done) => {
    const originalEnv = process.env.NODE_ENV;
    const originalExit = process.exit;

    let exitCode: number | undefined;
    (process as any).exit = (code: number) => { exitCode = code; };
    process.env.NODE_ENV = 'production';

    const guard = new CrashGuard();
    (guard as any).active = true;

    (guard as any).handleCrash('uncaughtException', new Error('prod crash'));

    setTimeout(() => {
      (process as any).exit = originalExit;
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;

      assert.strictEqual(exitCode, 1, 'process.exit(1) should have been called in production');
      done();
    }, 200);
  });

  // ── Bug Fix #1 regression: unhandledRejection must NOT call process.exit ──
  it('[BUG FIX] unhandledRejection should NOT call process.exit even in production', (_, done) => {
    const originalEnv = process.env.NODE_ENV;
    const originalExit = process.exit;

    let exitCode: number | undefined;
    (process as any).exit = (code: number) => { exitCode = code; };
    process.env.NODE_ENV = 'production';

    const guard = new CrashGuard();
    (guard as any).active = true;

    (guard as any).handleCrash('unhandledRejection', new Error('rejected promise'));

    setTimeout(() => {
      (process as any).exit = originalExit;
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;

      assert.strictEqual(exitCode, undefined, 'process.exit should NOT be called for unhandledRejection');
      done();
    }, 200);
  });

  it('[BUG FIX] unhandledRejection should still emit crash event without killing process', () => {
    process.env.NODE_ENV = 'test';
    const guard = new CrashGuard();
    let event: any = null;
    guard.on('crash', (e) => { event = e; });
    (guard as any).active = true;

    (guard as any).handleCrash('unhandledRejection', new Error('async failure'));

    assert.ok(event, 'Should emit crash event');
    assert.strictEqual(event.type, 'unhandledRejection');
    // Message should NOT say "tearing down the container" anymore
    assert.ok(!event.suggestions[0].message.includes('tearing down'), 'Should not say tearing down');
  });
});
