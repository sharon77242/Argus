import { EventEmitter } from "node:events";
import type { TracedQuery } from "../instrumentation/engine.ts";

interface Sample {
  hit: boolean;
  driver: string;
  ts: number;
}

export interface CacheStats {
  hitCount: number;
  missCount: number;
  /** 0–1 ratio of hits to total accesses in the current window. */
  hitRate: number;
  windowMs: number;
  driver: string;
  timestamp: number;
}

export type CacheDegradedEvent = CacheStats;

export interface CacheMonitorOptions {
  /** Sliding window size in ms. Default: 60 000. */
  windowMs?: number;
  /** Minimum number of samples in the window before a degraded event can fire. Default: 10. */
  minSamples?: number;
  /** Fire 'cache-degraded' when hit rate drops below this value (0–1). Default: 0.5. */
  minHitRate?: number;
}

export class CacheMonitor extends EventEmitter {
  private samples: Sample[] = [];
  private sources = new Map<EventEmitter, (q: TracedQuery) => void>();
  private readonly windowMs: number;
  private readonly minSamples: number;
  private readonly minHitRate: number;

  constructor(options: CacheMonitorOptions = {}) {
    super();
    this.windowMs = options.windowMs ?? 60_000;
    this.minSamples = options.minSamples ?? 10;
    this.minHitRate = options.minHitRate ?? 0.5;
  }

  on(event: "cache-degraded", listener: (e: CacheDegradedEvent) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  /** Attach to an EventEmitter that emits TracedQuery events on the 'query' channel. */
  attach(source: EventEmitter): this {
    if (this.sources.has(source)) return this;
    const listener = (q: TracedQuery) => this._onQuery(q);
    source.on("query", listener);
    this.sources.set(source, listener);
    return this;
  }

  /** Remove a previously attached source. */
  detach(source: EventEmitter): this {
    const listener = this.sources.get(source);
    if (listener) {
      source.off("query", listener);
      this.sources.delete(source);
    }
    return this;
  }

  /** Detach all sources. */
  stop(): void {
    for (const [src, fn] of this.sources) src.off("query", fn);
    this.sources.clear();
  }

  _onQuery(q: TracedQuery): void {
    if (q.cacheHit === undefined || !q.driver) return;

    const now = Date.now();
    this.samples.push({ hit: q.cacheHit, driver: q.driver, ts: now });
    this._evict(now);

    const driverSamples = this.samples.filter((s) => s.driver === q.driver);
    if (driverSamples.length < this.minSamples) return;

    const hitCount = driverSamples.filter((s) => s.hit).length;
    const missCount = driverSamples.length - hitCount;
    const hitRate = hitCount / driverSamples.length;

    if (hitRate < this.minHitRate) {
      this.emit("cache-degraded", {
        hitCount,
        missCount,
        hitRate,
        windowMs: this.windowMs,
        driver: q.driver,
        timestamp: now,
      } satisfies CacheDegradedEvent);
    }
  }

  /** Get current cache stats for a specific driver. Returns null if no samples exist. */
  getStats(driver: string): CacheStats | null {
    const now = Date.now();
    this._evict(now);
    const driverSamples = this.samples.filter((s) => s.driver === driver);
    if (driverSamples.length === 0) return null;

    const hitCount = driverSamples.filter((s) => s.hit).length;
    const missCount = driverSamples.length - hitCount;
    return {
      hitCount,
      missCount,
      hitRate: hitCount / driverSamples.length,
      windowMs: this.windowMs,
      driver,
      timestamp: now,
    };
  }

  private _evict(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].ts < cutoff) {
      this.samples.shift();
    }
  }
}
