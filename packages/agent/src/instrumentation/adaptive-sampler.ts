export interface AdaptiveSamplerOptions {
  /**
   * Token refill rate in tokens per millisecond.
   * Default: 1/1000 = 1 token per second.
   */
  ratePerMs?: number;
  /**
   * Maximum tokens a bucket can hold (burst capacity).
   * Default: 10.
   */
  burst?: number;
}

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

/**
 * Token-bucket adaptive sampler.
 *
 * Each category (e.g. 'query', 'http') has an independent bucket.  Buckets
 * start full.  Each `shouldSample()` call costs one token; tokens refill
 * continuously at `ratePerMs`.  When the bucket is empty the call returns
 * false and the event is dropped.
 */
export class AdaptiveSampler {
  private readonly ratePerMs: number;
  private readonly burst: number;
  private buckets = new Map<string, Bucket>();

  constructor(options: AdaptiveSamplerOptions = {}) {
    this.ratePerMs = options.ratePerMs ?? 1 / 1_000;
    this.burst = options.burst ?? 10;
  }

  /** Returns true if the event should be sampled (token consumed), false if it should be dropped. */
  shouldSample(category: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(category);
    if (!bucket) {
      bucket = { tokens: this.burst, lastRefillAt: now };
      this.buckets.set(category, bucket);
    }

    const elapsed = now - bucket.lastRefillAt;
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * this.ratePerMs);
    bucket.lastRefillAt = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Reset bucket(s). Resets a single category if provided, or all buckets if omitted. */
  reset(category?: string): void {
    if (category !== undefined) {
      this.buckets.delete(category);
    } else {
      this.buckets.clear();
    }
  }

  /** Returns the current token count for a category (without consuming a token). */
  getTokens(category: string): number {
    const now = Date.now();
    const bucket = this.buckets.get(category);
    if (!bucket) return this.burst;
    const elapsed = now - bucket.lastRefillAt;
    return Math.min(this.burst, bucket.tokens + elapsed * this.ratePerMs);
  }
}
