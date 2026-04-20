import { EventEmitter } from "node:events";
import type { TracedQuery } from "../instrumentation/engine.ts";

/** User-supplied function that runs EXPLAIN on the given query and returns the plan rows. */
export type ExplainExecutor = (query: string) => Promise<unknown[]>;

export interface ExplainOptions {
  /** Called with the normalized query (placeholders replaced with NULL). */
  executor: ExplainExecutor;
  /** Minimum per-pattern gap between EXPLAIN calls in ms. Default: 60 000. */
  cooldownMs?: number;
  /** Only EXPLAIN queries that took longer than this in ms. Default: 100. */
  slowThresholdMs?: number;
}

export interface ExplainResult {
  /** Original sanitized query. */
  query: string;
  /** Query with ? / $N replaced by NULL, used as the EXPLAIN input. */
  normalizedQuery: string;
  plan: unknown[];
  driver?: string;
  durationMs: number;
  timestamp: number;
}

export class ExplainAnalyzer extends EventEmitter {
  private readonly executor: ExplainExecutor;
  private readonly cooldownMs: number;
  private readonly slowThresholdMs: number;
  private lastExplain = new Map<string, number>();
  private sources = new Map<EventEmitter, (q: TracedQuery) => void>();

  constructor(options: ExplainOptions) {
    super();
    this.executor = options.executor;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.slowThresholdMs = options.slowThresholdMs ?? 100;
  }

  on(event: "explain", listener: (e: ExplainResult) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  /** Attach to an EventEmitter that emits TracedQuery events on the 'query' channel. */
  attach(source: EventEmitter): this {
    if (this.sources.has(source)) return this;
    const listener = (q: TracedQuery) => { void this._onQuery(q); };
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

  private async _onQuery(q: TracedQuery): Promise<void> {
    if (q.durationMs < this.slowThresholdMs) return;

    const normalized = this._normalize(q.sanitizedQuery);
    const now = Date.now();
    const last = this.lastExplain.get(normalized) ?? 0;
    if (now - last < this.cooldownMs) return;

    this.lastExplain.set(normalized, now);

    try {
      const plan = await this.executor(normalized);
      this.emit("explain", {
        query: q.sanitizedQuery,
        normalizedQuery: normalized,
        plan,
        driver: q.driver,
        durationMs: q.durationMs,
        timestamp: now,
      } satisfies ExplainResult);
    } catch (err) {
      this.emit("error", err as Error);
    }
  }

  /**
   * Directly run EXPLAIN for a given query string outside of the auto-attach path.
   * Returns null if the executor throws.
   */
  async analyze(query: string): Promise<ExplainResult | null> {
    const normalized = this._normalize(query);
    const now = Date.now();

    try {
      const plan = await this.executor(normalized);
      return {
        query,
        normalizedQuery: normalized,
        plan,
        durationMs: 0,
        timestamp: now,
      };
    } catch {
      return null;
    }
  }

  /** Replace ? and $N placeholders with NULL so the query is valid for EXPLAIN. */
  private _normalize(query: string): string {
    return query.replace(/\?|\$\d+/g, "NULL").trim();
  }
}
