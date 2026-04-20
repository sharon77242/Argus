import { EventEmitter } from "node:events";
import type { TracedQuery } from "../instrumentation/engine.ts";

export interface TransactionEvent {
  driver: string;
  durationMs: number;
  queryCount: number;
  /** True when the transaction ended with ROLLBACK. */
  aborted: boolean;
  traceId?: string;
  correlationId?: string;
  timestamp: number;
}

export interface TransactionMonitorOptions {
  /** Max ms a transaction may be open before it is silently evicted. Default: 60 000. */
  maxOpenMs?: number;
}

interface OpenTxn {
  start: number;
  queryCount: number;
  driver: string;
  traceId?: string;
  correlationId?: string;
}

const BEGIN_RE = /^\s*BEGIN\b/i;
const COMMIT_RE = /^\s*COMMIT\b/i;
const ROLLBACK_RE = /^\s*ROLLBACK\b/i;

export class TransactionMonitor extends EventEmitter {
  private openTxns = new Map<string, OpenTxn>();
  private sources = new Map<EventEmitter, (q: TracedQuery) => void>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly maxOpenMs: number;

  constructor(options: TransactionMonitorOptions = {}) {
    super();
    this.maxOpenMs = options.maxOpenMs ?? 60_000;
  }

  on(event: "transaction", listener: (e: TransactionEvent) => void): this;
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
    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => this._evictStale(), this.maxOpenMs);
      this.cleanupTimer.unref();
    }
    return this;
  }

  /** Remove a previously attached source. */
  detach(source: EventEmitter): this {
    const listener = this.sources.get(source);
    if (listener) {
      source.off("query", listener);
      this.sources.delete(source);
    }
    if (this.sources.size === 0 && this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    return this;
  }

  /** Detach all sources and stop the cleanup timer. */
  stop(): void {
    for (const [src, fn] of this.sources) src.off("query", fn);
    this.sources.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Number of currently open (un-committed) transactions. */
  get openCount(): number {
    return this.openTxns.size;
  }

  _onQuery(q: TracedQuery): void {
    const key = q.traceId ?? q.correlationId ?? `${q.driver ?? "unknown"}-default`;
    const sql = q.sanitizedQuery;

    if (BEGIN_RE.test(sql)) {
      this.openTxns.set(key, {
        start: q.timestamp,
        queryCount: 0,
        driver: q.driver ?? "unknown",
        traceId: q.traceId,
        correlationId: q.correlationId,
      });
    } else if (COMMIT_RE.test(sql) || ROLLBACK_RE.test(sql)) {
      const txn = this.openTxns.get(key);
      if (txn) {
        this.openTxns.delete(key);
        this.emit("transaction", {
          driver: txn.driver,
          durationMs: Date.now() - txn.start,
          queryCount: txn.queryCount,
          aborted: ROLLBACK_RE.test(sql),
          traceId: txn.traceId,
          correlationId: txn.correlationId,
          timestamp: Date.now(),
        } satisfies TransactionEvent);
      }
    } else {
      const txn = this.openTxns.get(key);
      if (txn) txn.queryCount++;
    }
  }

  private _evictStale(): void {
    const cutoff = Date.now() - this.maxOpenMs;
    for (const [key, txn] of this.openTxns) {
      if (txn.start < cutoff) this.openTxns.delete(key);
    }
  }
}
