import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreakerDetector, type QueryLike, type HttpLike } from '../../src/analysis/circuit-breaker-detector.ts';

const NOW = Date.now();
const RECENT = (offsetMs = 0): number => NOW - offsetMs;

function makeQuery(opts: Partial<QueryLike> & { error?: boolean } = {}): QueryLike {
  return {
    driver: opts.driver ?? 'pg',
    host: opts.host ?? 'db.example.com',
    durationMs: opts.durationMs ?? 10,
    error: opts.error ?? false,
    timestamp: opts.timestamp ?? RECENT(),
    sanitizedQuery: opts.sanitizedQuery ?? 'SELECT 1',
  };
}

function makeHttp(opts: Partial<HttpLike> & { error?: boolean } = {}): HttpLike {
  return {
    url: opts.url ?? 'https://api.example.com/endpoint',
    host: opts.host,
    durationMs: opts.durationMs ?? 10,
    statusCode: opts.statusCode ?? 200,
    error: opts.error ?? false,
    timestamp: opts.timestamp ?? RECENT(),
  };
}

describe('CircuitBreakerDetector', () => {
  test('fires when 6/10 queries to same driver fail in 60s window', () => {
    const detector = new CircuitBreakerDetector({ minCalls: 10, errorRateThreshold: 0.5 });

    const events: QueryLike[] = [
      ...Array.from({ length: 6 }, () => makeQuery({ error: true })),
      ...Array.from({ length: 4 }, () => makeQuery({ error: false })),
    ];

    const suggestions = detector.analyze(events);
    assert.ok(suggestions.length > 0, 'Should produce suggestions');
    assert.ok(suggestions[0].errorRate >= 0.5, 'Error rate should be >= 0.5');
    assert.equal(suggestions[0].errorCalls, 6);
    assert.equal(suggestions[0].totalCalls, 10);
  });

  test('does not fire below threshold (4/10 errors = 40%)', () => {
    const detector = new CircuitBreakerDetector({ minCalls: 10, errorRateThreshold: 0.5 });

    const events: QueryLike[] = [
      ...Array.from({ length: 4 }, () => makeQuery({ error: true })),
      ...Array.from({ length: 6 }, () => makeQuery({ error: false })),
    ];

    const suggestions = detector.analyze(events);
    assert.equal(suggestions.length, 0, 'Should not fire below 50% error rate');
  });

  test('does not fire when below minCalls (only 5 calls)', () => {
    const detector = new CircuitBreakerDetector({ minCalls: 10, errorRateThreshold: 0.5 });

    const events: QueryLike[] = [
      ...Array.from({ length: 5 }, () => makeQuery({ error: true })),
    ];

    const suggestions = detector.analyze(events);
    assert.equal(suggestions.length, 0, 'Should not fire when below minCalls threshold');
  });

  test('resets after window slides past failure window', () => {
    const detector = new CircuitBreakerDetector({
      minCalls: 10,
      errorRateThreshold: 0.5,
      windowMs: 60_000,
    });

    // Old events (outside the 60s window)
    const oldEvents: QueryLike[] = Array.from({ length: 10 }, () =>
      makeQuery({ error: true, timestamp: RECENT(90_000) }) // 90 seconds ago
    );

    const suggestions = detector.analyze(oldEvents);
    assert.equal(suggestions.length, 0, 'Should not fire for events outside the window');
  });

  test('suggestion includes suggestedFix with circuit-breaker pattern example', () => {
    const detector = new CircuitBreakerDetector({ minCalls: 5, errorRateThreshold: 0.5 });

    const events: QueryLike[] = [
      ...Array.from({ length: 5 }, () => makeQuery({ error: true })),
      ...Array.from({ length: 5 }, () => makeQuery({ error: false })),
    ];

    const suggestions = detector.analyze(events);
    assert.ok(suggestions.length > 0);
    assert.ok(suggestions[0].suggestedFix.includes('circuit breaker'), 'suggestedFix should mention circuit breaker');
    assert.ok(suggestions[0].suggestedFix.includes('opossum'), 'suggestedFix should include a library example');
  });

  test('detects HTTP errors (5xx status codes)', () => {
    const detector = new CircuitBreakerDetector({ minCalls: 5, errorRateThreshold: 0.4 });

    const events: HttpLike[] = [
      ...Array.from({ length: 5 }, () => makeHttp({ statusCode: 503, host: 'api.example.com' })),
      ...Array.from({ length: 5 }, () => makeHttp({ statusCode: 200, host: 'api.example.com' })),
    ];

    const suggestions = detector.analyze(events);
    assert.ok(suggestions.length > 0, 'Should detect HTTP 5xx as errors');
    assert.ok(suggestions[0].destination.includes('api.example.com'));
  });

  test('separates buckets by destination', () => {
    const detector = new CircuitBreakerDetector({ minCalls: 5, errorRateThreshold: 0.4 });

    const events: QueryLike[] = [
      // Host A: all failing
      ...Array.from({ length: 5 }, () => makeQuery({ error: true, host: 'db-a.example.com' })),
      // Host B: all succeeding
      ...Array.from({ length: 5 }, () => makeQuery({ error: false, host: 'db-b.example.com' })),
    ];

    const suggestions = detector.analyze(events);
    assert.equal(suggestions.length, 1, 'Should only flag the failing destination');
    assert.equal(suggestions[0].destination, 'db-a.example.com');
  });

  test('returns empty array for empty event list', () => {
    const detector = new CircuitBreakerDetector();
    assert.deepEqual(detector.analyze([]), []);
  });
});
