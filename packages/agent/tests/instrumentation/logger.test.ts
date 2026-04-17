import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LoggerInstrumentation, type TracedLog } from '../../src/instrumentation/logger.ts';

describe('LoggerInstrumentation', () => {
  it('should trace console logs and apply entropy scrubbing', () => {
    const instrumentation = new LoggerInstrumentation(() => 'test.ts:1', { scrubContext: true, entropyThreshold: 2.0 });
    let capturedLog: TracedLog | null = null;

    instrumentation.on('log', (log) => {
      capturedLog = log;
    });

    instrumentation.enable();

    // Use console.log with a high-entropy string
    // A JWT or random base64 string
    const secret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJs...'; 
    
    // We suppress stdout output dynamically by backing up the stream?
    // Actually our test runner captures standard out. 
    // Wait, let's keep it simple. It prints but also emits.
    console.log('Testing entropy', secret);

    instrumentation.disable();

    assert.ok(capturedLog);
    assert.strictEqual(capturedLog.level, 'log');
    assert.strictEqual(capturedLog.argsLength, 2);
    // Because we set threshold tight, it should have been scrubbed
    assert.ok(capturedLog.scrubbed, 'Should indicate scrubbing occurred');
  });

  it('should pass log structures to the analyzer', () => {
    const instrumentation = new LoggerInstrumentation(() => 'test.ts:1');
    let capturedLog: TracedLog | null = null;

    instrumentation.on('log', (log) => {
      capturedLog = log;
    });

    instrumentation.enable();
    console.warn('String', { mix: true });
    instrumentation.disable();

    assert.ok(capturedLog);
    assert.strictEqual(capturedLog.level, 'warn');
    assert.ok(capturedLog.suggestions);
    assert.strictEqual(capturedLog.suggestions[0].rule, 'unstructured-log');
  });
});
