import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CircuitBreakerSuggestion {
  destination: string;
  driver?: string;
  errorRate: number;      // 0–1
  totalCalls: number;
  errorCalls: number;
  windowMs: number;
  suggestedFix: string;
}

// Minimal types to avoid circular imports — mirrors the shapes emitted by the engine
export interface QueryLike {
  sanitizedQuery?: string;
  driver?: string;
  host?: string;
  error?: string | Error | boolean;
  durationMs: number;
  timestamp?: number;
}

export interface HttpLike {
  url?: string;
  host?: string;
  statusCode?: number;
  error?: string | Error | boolean;
  durationMs: number;
  timestamp?: number;
}

export type CircuitBreakerEvent = QueryLike | HttpLike;

interface DestinationBucket {
  success: number;
  error: number;
  firstSeen: number;
  lastSeen: number;
  driver?: string;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MIN_CALLS = 10;
const DEFAULT_ERROR_RATE = 0.5;

interface PersistedState {
  buckets: Record<string, DestinationBucket>;
  savedAt: number;
}

function isHttpLike(e: CircuitBreakerEvent): e is HttpLike {
  return 'statusCode' in e || 'url' in e;
}

function isError(e: CircuitBreakerEvent): boolean {
  if (e.error) return true;
  if (isHttpLike(e)) {
    return typeof e.statusCode === 'number' && e.statusCode >= 500;
  }
  return false;
}

function getDestination(e: CircuitBreakerEvent): string {
  if (isHttpLike(e)) {
    if (e.host) return e.host;
    if (e.url) {
      try { return new URL(e.url).hostname; } catch { return e.url; }
    }
    return 'unknown-http';
  }
  return (e as QueryLike).host ?? (e as QueryLike).driver ?? 'unknown-db';
}

/**
 * Analyses a sliding window of query/HTTP events and surfaces destinations
 * where the error rate exceeds a threshold — suggesting a circuit-breaker pattern.
 *
 * Set `persistTo` to a file path to survive process restarts: bucket state is
 * saved after every `analyze()` call and loaded on construction, so an incident
 * spanning a restart is not lost.
 */
export class CircuitBreakerDetector {
  private readonly windowMs: number;
  private readonly minCalls: number;
  private readonly errorRateThreshold: number;
  private readonly persistTo: string | null;
  private priorBuckets: Map<string, DestinationBucket>;

  constructor(opts: {
    windowMs?: number;
    minCalls?: number;
    errorRateThreshold?: number;
    /** File path to persist bucket state across restarts. Directory is created if needed. */
    persistTo?: string;
  } = {}) {
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.minCalls = opts.minCalls ?? DEFAULT_MIN_CALLS;
    this.errorRateThreshold = opts.errorRateThreshold ?? DEFAULT_ERROR_RATE;
    this.persistTo = opts.persistTo ?? null;
    this.priorBuckets = this.loadState();
  }

  /**
   * Analyses events and returns circuit-breaker suggestions for any destination
   * whose error rate exceeds the configured threshold.
   *
   * If `persistTo` was set, prior bucket state from the last run is merged in
   * so incidents spanning a process restart are detected correctly.
   */
  analyze(events: CircuitBreakerEvent[]): CircuitBreakerSuggestion[] {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const buckets = new Map<string, DestinationBucket>();

    // Seed with prior persisted buckets (filtered to those still within window)
    for (const [dest, prior] of this.priorBuckets) {
      if (prior.lastSeen >= cutoff) {
        buckets.set(dest, { ...prior });
      }
    }

    for (const event of events) {
      const ts = event.timestamp ?? now;
      if (ts < cutoff) continue;

      const dest = getDestination(event);
      let bucket = buckets.get(dest);
      if (!bucket) {
        bucket = { success: 0, error: 0, firstSeen: ts, lastSeen: ts };
        if (!isHttpLike(event)) bucket.driver = (event as QueryLike).driver;
        buckets.set(dest, bucket);
      }
      bucket.lastSeen = Math.max(bucket.lastSeen, ts);

      if (isError(event)) {
        bucket.error++;
      } else {
        bucket.success++;
      }
    }

    // Persist current state for the next run
    this.saveState(buckets, now);

    const suggestions: CircuitBreakerSuggestion[] = [];

    for (const [dest, bucket] of buckets) {
      const total = bucket.success + bucket.error;
      if (total < this.minCalls) continue;

      const errorRate = bucket.error / total;
      if (errorRate < this.errorRateThreshold) continue;

      suggestions.push({
        destination: dest,
        driver: bucket.driver,
        errorRate,
        totalCalls: total,
        errorCalls: bucket.error,
        windowMs: this.windowMs,
        suggestedFix: [
          `Destination '${dest}' has a ${(errorRate * 100).toFixed(0)}% error rate over ${total} calls in the last ${this.windowMs / 1000}s.`,
          `Consider implementing a circuit breaker:`,
          `  import CircuitBreaker from 'opossum';`,
          `  const cb = new CircuitBreaker(yourFn, { errorThresholdPercentage: 50, timeout: 3000, resetTimeout: 30000 });`,
          `  cb.fallback(() => cachedResult);`,
        ].join('\n'),
      });
    }

    return suggestions;
  }

  /** Remove all persisted state (useful in tests). */
  clearPersistedState(): void {
    this.priorBuckets = new Map();
    if (this.persistTo) {
      try { writeFileSync(this.persistTo, JSON.stringify({ buckets: {}, savedAt: Date.now() })); } catch { /* ignore */ }
    }
  }

  private loadState(): Map<string, DestinationBucket> {
    if (!this.persistTo) return new Map();
    try {
      const raw = readFileSync(this.persistTo, 'utf8');
      const state = JSON.parse(raw) as PersistedState;
      const cutoff = Date.now() - this.windowMs * 2; // discard entries older than 2× window
      const map = new Map<string, DestinationBucket>();
      for (const [dest, bucket] of Object.entries(state.buckets)) {
        if (bucket.lastSeen >= cutoff) map.set(dest, bucket);
      }
      return map;
    } catch {
      return new Map(); // file missing or corrupt — start fresh
    }
  }

  private saveState(buckets: Map<string, DestinationBucket>, now: number): void {
    if (!this.persistTo) return;
    try {
      mkdirSync(dirname(this.persistTo), { recursive: true });
      const state: PersistedState = {
        buckets: Object.fromEntries(buckets),
        savedAt: now,
      };
      writeFileSync(this.persistTo, JSON.stringify(state), 'utf8');
    } catch { /* never crash the host app over persistence */ }
  }
}
