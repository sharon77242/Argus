import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrashGuard } from '../../src/profiling/crash-guard.ts';
import { EventEmitter } from 'node:events';

describe('CrashGuard', () => {
  it('should intercept uncaught exceptions and emit suggestions', () => {
    process.env.NODE_ENV = 'test';
    
    const guard = new CrashGuard((stack) => stack.toUpperCase()); // mock resolver
    
    let crashEmitted: any = null;
    guard.on('crash', (event) => { crashEmitted = event; });
    
    // Set active explicitly to avoid touching process.on
    (guard as any).active = true;

    // Trigger the private method directly to avoid breaking the Node test runner's
    // own uncaughtException listeners.
    const testError = new Error('test crash');
    (guard as any).handleCrash('uncaughtException', testError);

    assert.ok(crashEmitted);
    assert.strictEqual(crashEmitted.type, 'uncaughtException');
    assert.strictEqual(crashEmitted.error, testError);
    assert.ok(crashEmitted.suggestions[0]);
    assert.strictEqual(crashEmitted.suggestions[0].severity, 'critical');
    // Ensure the resolver was called
    assert.ok(crashEmitted.resolvedStack.includes('TEST CRASH'));
  });
});

