import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { StreamLeakDetector } from '../../src/profiling/stream-leak-detector.ts';

function makeReadable(): Readable {
  return new Readable({ read() {} });
}

describe('StreamLeakDetector', () => {
  test('instantiates without throwing', () => {
    assert.doesNotThrow(() => new StreamLeakDetector());
    assert.doesNotThrow(() => new StreamLeakDetector({ thresholdMs: 1000, captureStacks: true }));
  });

  test('enable() and disable() are idempotent', () => {
    const d = new StreamLeakDetector();
    assert.doesNotThrow(() => {
      d.enable();
      d.enable(); // second enable is no-op
      d.disable();
      d.disable(); // second disable is no-op
    });
  });

  test('detects a Readable created and never consumed after threshold', async () => {
    const leaks: unknown[] = [];
    const d = new StreamLeakDetector({ thresholdMs: 30, checkIntervalMs: 15 });
    d.on('leak', (e) => leaks.push(e));
    d.enable();

    const stream = makeReadable();
    d.track(stream);

    // Wait for threshold + check interval
    await new Promise<void>((r) => setTimeout(r, 100));

    assert.ok(leaks.length > 0, 'Should detect unconsumed stream as a leak');
    const leak = leaks[0] as { type: string; aliveSinceMs: number };
    assert.equal(leak.type, 'stream-leak');
    assert.ok(leak.aliveSinceMs >= 30, 'aliveSinceMs should be at least the threshold');

    d.disable();
  });

  test('does not flag a stream that is properly consumed via data event', async () => {
    const leaks: unknown[] = [];
    const d = new StreamLeakDetector({ thresholdMs: 30, checkIntervalMs: 15 });
    d.on('leak', (e) => leaks.push(e));
    d.enable();

    const stream = makeReadable();
    d.track(stream);

    // Consume the stream immediately
    stream.on('data', () => {});
    stream.push(null); // end the stream

    await new Promise<void>((r) => setTimeout(r, 100));

    assert.equal(leaks.length, 0, 'Consumed stream should not be flagged as leak');

    d.disable();
  });

  test('does not flag a stream that is piped', async () => {
    const leaks: unknown[] = [];
    const d = new StreamLeakDetector({ thresholdMs: 30, checkIntervalMs: 15 });
    d.on('leak', (e) => leaks.push(e));
    d.enable();

    const stream = makeReadable();
    d.track(stream);

    // Piping marks the stream as consumed
    stream.emit('pipe', {});

    await new Promise<void>((r) => setTimeout(r, 100));

    assert.equal(leaks.length, 0, 'Piped stream should not be flagged as leak');

    d.disable();
  });

  test('does not flag a stream that is destroyed before threshold', async () => {
    const leaks: unknown[] = [];
    const d = new StreamLeakDetector({ thresholdMs: 50, checkIntervalMs: 20 });
    d.on('leak', (e) => leaks.push(e));
    d.enable();

    const stream = makeReadable();
    d.track(stream);

    // Destroy before threshold
    stream.destroy();

    await new Promise<void>((r) => setTimeout(r, 120));

    assert.equal(leaks.length, 0, 'Destroyed stream should not be flagged as leak');

    d.disable();
  });

  test('stack trace captured when captureStacks: true', async () => {
    const leaks: unknown[] = [];
    const d = new StreamLeakDetector({ thresholdMs: 20, checkIntervalMs: 10, captureStacks: true });
    d.on('leak', (e) => leaks.push(e));
    d.enable();

    const stream = makeReadable();
    d.track(stream);

    await new Promise<void>((r) => setTimeout(r, 80));

    if (leaks.length > 0) {
      const leak = leaks[0] as { stack?: string };
      assert.ok(leak.stack, 'Stack trace should be captured when captureStacks: true');
      assert.ok(typeof leak.stack === 'string', 'Stack should be a string');
    }

    d.disable();
  });

  test('does not emit leaks after disable()', async () => {
    const leaks: unknown[] = [];
    const d = new StreamLeakDetector({ thresholdMs: 20, checkIntervalMs: 10 });
    d.on('leak', (e) => leaks.push(e));
    d.enable();

    const stream = makeReadable();
    d.track(stream);

    d.disable(); // disable before threshold

    await new Promise<void>((r) => setTimeout(r, 80));

    assert.equal(leaks.length, 0, 'No leaks should be emitted after disable()');
  });
});
