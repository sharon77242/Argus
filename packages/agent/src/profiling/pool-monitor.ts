import { EventEmitter } from "node:events";

export interface PoolMonitorOptions {
  /** Fire 'pool-exhaustion' when this many clients are waiting for a connection. Default: 3. */
  maxWaitingCount?: number;
  /** Fire 'slow-acquire' when acquiring a connection exceeds this duration (ms). Default: 1000. */
  maxWaitMs?: number;
  /** How often to poll pool statistics (ms). Default: 5000. */
  checkIntervalMs?: number;
}

/**
 * Minimal duck-type interface for a monitored pool.
 * Compatible with pg.Pool, mysql2 pool, and generic-pool out of the box.
 */
export interface PoolLike {
  /** Total open connections (active + idle). */
  totalCount?: number;
  /** Connections currently not serving any client. */
  idleCount?: number;
  /** Clients waiting because no idle connection is available. */
  waitingCount?: number;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface PoolExhaustionEvent {
  driver: string;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  timestamp: number;
}

export interface SlowAcquireEvent {
  driver: string;
  /** Time a client spent waiting before receiving a connection (ms). */
  waitMs: number;
  totalCount: number;
  timestamp: number;
}

interface Registration {
  pool: PoolLike;
  driver: string;
  timer: NodeJS.Timeout;
  waitStartAt: number | null;
  acquireListener: (() => void) | null;
}

/**
 * Watches one or more connection pools for exhaustion and slow-acquisition events.
 *
 * Call `monitor.watch(pool, 'pg')` for each pool instance after it is created.
 * Supports any pool that exposes `totalCount` / `idleCount` / `waitingCount` getters
 * and/or emits an `'acquire'` event (pg.Pool satisfies all three; mysql2 satisfies the event).
 *
 * ✅ Prod Safe: Yes
 * 📊 Resource Impact: Low (polling interval + event listeners only)
 */
export class PoolMonitor extends EventEmitter {
  private readonly maxWaitingCount: number;
  private readonly maxWaitMs: number;
  private readonly checkIntervalMs: number;
  private readonly registrations = new Map<PoolLike, Registration>();

  constructor(options: PoolMonitorOptions = {}) {
    super();
    this.maxWaitingCount = options.maxWaitingCount ?? 3;
    this.maxWaitMs = options.maxWaitMs ?? 1000;
    this.checkIntervalMs = options.checkIntervalMs ?? 5_000;
  }

  /**
   * Start monitoring a pool. Idempotent — watching the same pool instance twice is a no-op.
   */
  public watch(pool: PoolLike, driver: string): this {
    if (this.registrations.has(pool)) return this;

    const reg: Registration = {
      pool,
      driver,
      timer: null!,
      waitStartAt: null,
      acquireListener: null,
    };

    // Subscribe to the 'acquire' event for precise slow-acquire timing
    if (typeof pool.on === "function") {
      const onAcquire = () => {
        if (reg.waitStartAt !== null) {
          const waitMs = Date.now() - reg.waitStartAt;
          reg.waitStartAt = null;
          if (waitMs > this.maxWaitMs) {
            this.emit("slow-acquire", {
              driver,
              waitMs,
              totalCount: pool.totalCount ?? 0,
              timestamp: Date.now(),
            } satisfies SlowAcquireEvent);
          }
        }
      };
      pool.on("acquire", onAcquire);
      reg.acquireListener = onAcquire;
    }

    reg.timer = setInterval(() => this.checkPool(reg), this.checkIntervalMs);
    reg.timer.unref();

    this.registrations.set(pool, reg);
    return this;
  }

  /**
   * Stop monitoring a specific pool and clean up its listeners.
   */
  public unwatch(pool: PoolLike): this {
    const reg = this.registrations.get(pool);
    if (!reg) return this;

    clearInterval(reg.timer);
    if (reg.acquireListener && typeof pool.removeListener === "function") {
      pool.removeListener("acquire", reg.acquireListener);
    }
    this.registrations.delete(pool);
    return this;
  }

  /**
   * Stop monitoring all registered pools.
   */
  public stop(): void {
    for (const pool of this.registrations.keys()) {
      this.unwatch(pool);
    }
  }

  /** Number of pools currently being monitored. */
  public get poolCount(): number {
    return this.registrations.size;
  }

  private checkPool(reg: Registration): void {
    const { pool, driver } = reg;
    const waitingCount = pool.waitingCount ?? 0;
    const totalCount = pool.totalCount ?? 0;
    const idleCount = pool.idleCount ?? 0;

    // Polling-based slow-acquire timing for pools that don't emit 'acquire'
    if (reg.acquireListener === null) {
      if (waitingCount > 0 && reg.waitStartAt === null) {
        reg.waitStartAt = Date.now();
      } else if (waitingCount === 0 && reg.waitStartAt !== null) {
        const waitMs = Date.now() - reg.waitStartAt;
        reg.waitStartAt = null;
        if (waitMs > this.maxWaitMs) {
          this.emit("slow-acquire", {
            driver,
            waitMs,
            totalCount,
            timestamp: Date.now(),
          } satisfies SlowAcquireEvent);
        }
      }
    } else {
      // Acquire-event path: record when waiting starts so the handler can measure
      if (waitingCount > 0 && reg.waitStartAt === null) {
        reg.waitStartAt = Date.now();
      } else if (waitingCount === 0) {
        reg.waitStartAt = null;
      }
    }

    if (waitingCount >= this.maxWaitingCount) {
      this.emit("pool-exhaustion", {
        driver,
        totalCount,
        idleCount,
        waitingCount,
        timestamp: Date.now(),
      } satisfies PoolExhaustionEvent);
    }
  }
}
