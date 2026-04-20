export interface SlowQueryRecord {
  sanitizedQuery: string;
  durationMs: number;
  driver: string;
  timestamp: number;
  sourceLine?: string;
  correlationId?: string;
  /** W3C trace-id — present when the query ran inside a runWithContext() scope. */
  traceId?: string;
  /** The threshold that was exceeded, in ms. */
  thresholdMs: number;
}

/**
 * Built-in per-driver slow-query defaults (ms).
 *
 * Chosen based on each driver's expected latency profile:
 *   - In-memory stores (Redis)     →   50 ms  (cache miss = problem)
 *   - Local-disk stores (SQLite)   →  100 ms  (disk I/O on localhost)
 *   - Cloud KV (DynamoDB)          →  200 ms  (single-digit-ms SLA, network adds up)
 *   - OLTP relational (pg, mysql2) →  500 ms  (indexed queries should be fast)
 *   - Document / graph / search    → 1000 ms  (richer queries, more variance)
 *   - Analytics (ClickHouse, BQ)   → 5000–10 000 ms  (large scans are expected)
 *
 * These are always overridable via `options.thresholds` or env vars.
 */
export const DRIVER_DEFAULTS: Readonly<Record<string, number>> = {
  // ── relational ───────────────────────────────────────────
  pg: 500,
  mysql2: 500,
  mssql: 500,
  tedious: 500, // underlying MS SQL driver
  "better-sqlite3": 100, // local disk — fast

  // ── in-memory / cache ────────────────────────────────────
  redis: 50,
  ioredis: 50,

  // ── document / NoSQL ─────────────────────────────────────
  mongodb: 500,
  "@google-cloud/firestore": 1000,
  "@aws-sdk/client-dynamodb": 200,
  "@aws-sdk/lib-dynamodb": 200,

  // ── graph / search ───────────────────────────────────────
  "neo4j-driver": 1000,
  "@elastic/elasticsearch": 2000,

  // ── analytics (large scans are normal) ───────────────────
  "@clickhouse/client": 5000,
  "@google-cloud/bigquery": 10000,
  "cassandra-driver": 500,

  // ── ORM (overhead from the underlying driver) ────────────
  "@prisma/client": 1000,
};

export interface SlowQueryOptions {
  /**
   * Fallback threshold in ms used when no per-driver default applies.
   * Default: 1000. Overridden by env var ARGUS_SLOW_QUERY_THRESHOLD_MS.
   */
  defaultThresholdMs?: number;
  /**
   * Per-driver threshold overrides in ms (e.g. `{ pg: 500, redis: 50 }`).
   * Keys must match the driver name string used by the patch
   * (e.g. 'pg', 'mysql2', 'redis', 'ioredis', 'mongodb', '@prisma/client').
   * Overridden per-driver by ARGUS_SLOW_QUERY_THRESHOLD_<DRIVER> env vars.
   *
   * Env var key derivation: replace non-alphanumeric runs with `_`, uppercase.
   *   'pg'                    → ARGUS_SLOW_QUERY_THRESHOLD_PG
   *   'redis'                 → ARGUS_SLOW_QUERY_THRESHOLD_REDIS
   *   '@elastic/elasticsearch'→ ARGUS_SLOW_QUERY_THRESHOLD_ELASTIC_ELASTICSEARCH
   *   '@google-cloud/bigquery'→ ARGUS_SLOW_QUERY_THRESHOLD_GOOGLE_CLOUD_BIGQUERY
   */
  thresholds?: Record<string, number>;
  /**
   * Maximum number of slowest queries to retain in the log.
   * Default: 5.
   */
  topN?: number;
}

/**
 * Tracks slow queries per driver and maintains a top-N log of the slowest seen.
 *
 * Thresholds are resolved in this priority order (highest wins):
 *   1. ARGUS_SLOW_QUERY_THRESHOLD_<DRIVER> env var
 *   2. options.thresholds[driverName]
 *   3. DRIVER_DEFAULTS[driverName]  (built-in per-driver defaults)
 *   4. ARGUS_SLOW_QUERY_THRESHOLD_MS env var
 *   5. options.defaultThresholdMs (fallback: 1000 ms)
 */
export class SlowQueryMonitor {
  private readonly defaultThreshold: number;
  private readonly thresholds: Map<string, number>;
  private readonly topN: number;
  private slowLog: SlowQueryRecord[] = [];
  private readonly warnedDrivers = new Set<string>();

  constructor(options: SlowQueryOptions = {}) {
    const envDefault = parseInt(process.env.ARGUS_SLOW_QUERY_THRESHOLD_MS ?? "", 10);
    this.defaultThreshold = !isNaN(envDefault) ? envDefault : (options.defaultThresholdMs ?? 1000);
    this.topN = options.topN ?? 5;
    this.thresholds = new Map(Object.entries(options.thresholds ?? {}));
  }

  /**
   * Returns the effective threshold in ms for the given driver name.
   * Env var per-driver overrides are checked at call time so hot-reloads work.
   */
  public getThreshold(driver: string): number {
    // 1. Per-driver env var (highest priority)
    const envKey = `ARGUS_SLOW_QUERY_THRESHOLD_${this.driverToEnvKey(driver)}`;
    const envVal = parseInt(process.env[envKey] ?? "", 10);
    if (!isNaN(envVal)) return envVal;
    // 2. Per-driver options value
    if (this.thresholds.has(driver)) return this.thresholds.get(driver)!;
    // 3. Built-in per-driver default
    if (Object.prototype.hasOwnProperty.call(DRIVER_DEFAULTS, driver))
      return DRIVER_DEFAULTS[driver];
    // 4. Global fallback — warn once in non-production so new drivers don't silently inherit 1000 ms
    if (process.env.NODE_ENV !== "production" && !this.warnedDrivers.has(driver)) {
      this.warnedDrivers.add(driver);
      process.emitWarning(
        `[SlowQueryMonitor] No threshold registered for driver "${driver}" — falling back to ${this.defaultThreshold} ms. ` +
          `Add an entry to DRIVER_DEFAULTS in slow-query-monitor.ts or set ARGUS_SLOW_QUERY_THRESHOLD_${this.driverToEnvKey(driver)}.`,
        { code: "ARGUS_MISSING_DRIVER_THRESHOLD" },
      );
    }
    return this.defaultThreshold;
  }

  /**
   * Evaluate a query against its driver's threshold.
   * Returns the recorded SlowQueryRecord when the threshold is exceeded, null otherwise.
   */
  public check(
    sanitizedQuery: string,
    durationMs: number,
    driver: string,
    timestamp: number,
    sourceLine?: string,
    correlationId?: string,
    traceId?: string,
  ): SlowQueryRecord | null {
    const thresholdMs = this.getThreshold(driver);
    if (durationMs < thresholdMs) return null;

    const record: SlowQueryRecord = {
      sanitizedQuery,
      durationMs,
      driver,
      timestamp,
      sourceLine,
      correlationId,
      traceId,
      thresholdMs,
    };
    this.addToSlowLog(record);
    return record;
  }

  /** Returns the top-N slowest queries seen so far, sorted slowest first. */
  public getSlowQueries(): SlowQueryRecord[] {
    return [...this.slowLog];
  }

  /** Returns the single slowest query recorded, or undefined if none yet. */
  public getSlowest(): SlowQueryRecord | undefined {
    return this.slowLog[0];
  }

  /** Clears the slow query log. */
  public clear(): void {
    this.slowLog = [];
  }

  private addToSlowLog(record: SlowQueryRecord): void {
    this.slowLog.push(record);
    this.slowLog.sort((a, b) => b.durationMs - a.durationMs);
    if (this.slowLog.length > this.topN) {
      this.slowLog.length = this.topN;
    }
  }

  /** Convert a driver name to the uppercase env-var suffix form. */
  private driverToEnvKey(driver: string): string {
    return driver
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .toUpperCase()
      .replace(/^_+|_+$/g, "");
  }
}
