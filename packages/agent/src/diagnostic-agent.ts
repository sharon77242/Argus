import { EventEmitter } from "node:events";
import { SourceMapResolver } from "./profiling/source-map-resolver.ts";
import {
  RuntimeMonitor,
  type RuntimeMonitorOptions,
  type ProfilerEvent,
} from "./profiling/runtime-monitor.ts";
import {
  InstrumentationEngine,
  type TracedQuery,
  type InstrumentationOptions,
} from "./instrumentation/engine.ts";
import { MetricsAggregator, type AggregatorEvent } from "./export/aggregator.ts";
import { OTLPExporter, type ExporterConfig } from "./export/exporter.ts";
import { EntropyChecker } from "./sanitization/entropy-checker.ts";
import { applyDriverPatches, removeDriverPatches } from "./instrumentation/drivers/index.ts";
import { QueryAnalyzer, type QueryAnalyzerOptions } from "./analysis/query-analyzer.ts";
import {
  SlowQueryMonitor,
  type SlowQueryOptions,
  type SlowQueryRecord,
} from "./analysis/slow-query-monitor.ts";
import { GcMonitor, type GcMonitorOptions, type GcPressureEvent } from "./profiling/gc-monitor.ts";
import {
  PoolMonitor,
  type PoolMonitorOptions,
  type PoolLike,
  type PoolExhaustionEvent,
  type SlowAcquireEvent,
} from "./profiling/pool-monitor.ts";
import {
  createRequestContext,
  runWithContext,
  type RequestContext,
} from "./instrumentation/correlation.ts";
import {
  TransactionMonitor,
  type TransactionMonitorOptions,
  type TransactionEvent,
} from "./analysis/transaction-monitor.ts";
import { CacheMonitor, type CacheMonitorOptions } from "./analysis/cache-monitor.ts";
import { DnsMonitor, type DnsMonitorOptions } from "./instrumentation/dns-monitor.ts";
import {
  AdaptiveSampler,
  type AdaptiveSamplerOptions,
} from "./instrumentation/adaptive-sampler.ts";
import { StaticScanner } from "./analysis/static-scanner.ts";
import { HttpInstrumentation } from "./instrumentation/http.ts";
import { FsInstrumentation } from "./instrumentation/fs.ts";
import { LoggerInstrumentation, type LoggerOptions } from "./instrumentation/logger.ts";
import { CrashGuard } from "./profiling/crash-guard.ts";
import {
  ResourceLeakMonitor,
  type ResourceLeakMonitorOptions,
} from "./profiling/resource-leak-monitor.ts";
import { AuditScanner } from "./analysis/audit-scanner.ts";
import { detectAppTypes, type DetectionResult } from "./profiling/app-type-detector.ts";
import { validateLicense, type LicenseClaims } from "./licensing/license-validator.ts";
import { checkClockIntegrity } from "./licensing/clock-guard.ts";
import { writeExpirySignal } from "./licensing/expiry-signal.ts";
import { GracefulShutdown, type GracefulShutdownOptions } from "./profiling/graceful-shutdown.ts";

// WeakMap-based private storage for license claims — avoids exposing internal field on agent
const licenseClaims = new WeakMap<DiagnosticAgent, LicenseClaims>();

export function shouldExport(eventType: string, claims: LicenseClaims | null): boolean {
  if (!claims) return false; // free mode: local EventEmitter only, no OTLP export
  return claims.allowedEvents.includes(eventType);
  // sampleRates is always {} — no sampling side-effects on any tier
}

export type AppType = "web" | "db" | "worker";

export interface AgentProfileConfig {
  enabled?: boolean;
  environment?: "dev" | "test" | "prod";
  appType?: "auto" | AppType | AppType[];
  workspaceDir?: string;
  /** Options forwarded to QueryAnalyzer when query analysis is enabled. */
  queryAnalysis?: QueryAnalyzerOptions;
  /** Options forwarded to SlowQueryMonitor when slow query monitoring is enabled. */
  slowQueries?: SlowQueryOptions;
}

/**
 * High-level fluent builder for Argus.
 *
 * Wires together all subsystems (source maps, runtime monitoring,
 * instrumentation, aggregation, export) behind a single chainable API.
 *
 * Low-level classes remain available for power users who need
 * fine-grained control.
 *
 * @example
 * ```ts
 * const agent = await DiagnosticAgent.create()
 *   .withSourceMaps('./dist')
 *   .withRuntimeMonitor({ eventLoopThresholdMs: 50 })
 *   .withInstrumentation()
 *   .withExporter({ endpointUrl: '...', key, cert, ca })
 *   .start();
 *
 * // later …
 * agent.stop();
 * ```
 */
export class DiagnosticAgent extends EventEmitter {
  // ── configuration captured by the builder ──
  private globallyDisabled = false;
  private sourceMapDir: string | null = null;
  private monitorOptions: RuntimeMonitorOptions | null = null;
  private instrumentationOptions: InstrumentationOptions | null = null;
  private exporterConfig: ExporterConfig | null = null;
  private aggregatorWindowMs = 60_000;
  private entropyThreshold = 4.0;
  private queryAnalysisOptions: QueryAnalyzerOptions | null = null;
  private slowQueryOptions: SlowQueryOptions | null = null;
  private gcMonitorOptions: GcMonitorOptions | null = null;
  private poolMonitorOptions: PoolMonitorOptions | null = null;
  private transactionMonitorOptions: TransactionMonitorOptions | null = null;
  private cacheMonitorOptions: CacheMonitorOptions | null = null;
  private dnsMonitorOptions: DnsMonitorOptions | null = null;
  private adaptiveSamplerOptions: AdaptiveSamplerOptions | null = null;
  private staticScanDir: string | null = null;
  private httpTracingEnabled = false;
  private fsTracingEnabled = false;
  private logTracingOptions: LoggerOptions | null = null;
  private crashGuardEnabled = false;
  private leakMonitorOptions: ResourceLeakMonitorOptions | null = null;
  private auditScanDir: string | null = null;
  private gracefulShutdownOptions: GracefulShutdownOptions | null = null;

  // ── live instances (created on .start()) ──
  private resolver: SourceMapResolver | null = null;
  private monitor: RuntimeMonitor | null = null;
  private engine: InstrumentationEngine | null = null;
  private aggregator: MetricsAggregator | null = null;
  private exporter: OTLPExporter | null = null;
  private queryAnalyzer: QueryAnalyzer | null = null;
  private slowQueryMonitor: SlowQueryMonitor | null = null;
  private gcMonitor: GcMonitor | null = null;
  private poolMonitor: PoolMonitor | null = null;
  private transactionMonitor: TransactionMonitor | null = null;
  private cacheMonitor: CacheMonitor | null = null;
  private dnsMonitor: DnsMonitor | null = null;
  private adaptiveSampler: AdaptiveSampler | null = null;
  private httpTracker: HttpInstrumentation | null = null;
  private fsTracker: FsInstrumentation | null = null;
  private logTracker: LoggerInstrumentation | null = null;
  private crashGuard: CrashGuard | null = null;
  private leakMonitor: ResourceLeakMonitor | null = null;

  private running = false;
  // Listeners added by useConsoleLogger — kept so they can be removed on stop().
  private debugListeners: [string, (...args: unknown[]) => void][] = [];

  // Private constructor — use DiagnosticAgent.create()
  private constructor() {
    super();
    // High-frequency events (query, http, fs, log) may have many listeners
    // in production apps. 0 = unlimited, suppresses Node's 'possible memory leak' warning.
    this.setMaxListeners(0);
  }

  /**
   * Entry point — returns a fresh builder instance.
   */
  public static create(): DiagnosticAgent {
    return new DiagnosticAgent();
  }

  /**
   * Scans the nearest `package.json` and returns the detected app types
   * based on known package fingerprints (frameworks, DB drivers, queues).
   *
   * @param baseDir  Directory to look for `package.json` (defaults to `process.cwd()`).
   */
  public static detectAppTypes(baseDir?: string): DetectionResult {
    return detectAppTypes(baseDir);
  }

  /**
   * Generates a preconfigured DiagnosticAgent using highly optimized presets based on environment and application types.
   * Includes an `enabled` flag to return a true zero-overhead NoOp agent.
   *
   * Set `appType` to `'auto'` to auto-detect from `package.json` dependencies.
   */
  public static createProfile(config: AgentProfileConfig): DiagnosticAgent {
    const agent = new DiagnosticAgent();

    // Globally kill-switch the agent; .start() and .stop() will become 0-overhead
    // Environment variables take precedence over config object
    const envEnabled = process.env.DIAGNOSTIC_AGENT_ENABLED;
    const isGloballyDisabled =
      envEnabled !== undefined
        ? envEnabled === "false" || envEnabled === "0"
        : config.enabled === false;

    if (isGloballyDisabled) {
      agent.globallyDisabled = true;
      return agent;
    }

    const env = config.environment ?? "prod";

    // Resolve app types — 'auto' triggers package.json scanning
    let appTypes: AppType[];
    const selectedType = config.appType ?? "auto";
    if (selectedType === "auto") {
      const detected = detectAppTypes(config.workspaceDir);
      if (detected.types.length > 0) {
        appTypes = detected.types;
      } else {
        // No recognized packages found — don’t silently assume 'web'.
        // Emit a dev-time notice and apply no app-type-specific modules.
        appTypes = [];
        if (env !== "prod") {
          // Delay to after construction so listeners can attach
          setImmediate(() => {
            agent.emit(
              "info",
              "DiagnosticAgent: auto-detection found no recognized app type in package.json. " +
                'Pass appType explicitly ("web" | "db" | "worker") to enable app-specific monitoring.',
            );
          });
        }
      }
    } else {
      appTypes = Array.isArray(selectedType) ? selectedType : [selectedType];
    }

    // 1. Universal Production Safe Bindings
    agent.withCrashGuard();
    agent.withLogTracing();

    // 2. Dev/Test Scanners (Non-Prod)
    if (env === "dev" || env === "test") {
      agent.withFsTracing();
      if (config.workspaceDir) {
        agent.withStaticScanner(config.workspaceDir);
        agent.withAuditScanner(config.workspaceDir);
        agent.withSourceMaps(config.workspaceDir);
      }
    }

    // 3. Application Type Optimization — union modules from all specified types.
    //    Each `with*()` call is idempotent, so duplicates across types are harmless.
    for (const app of appTypes) {
      switch (app) {
        case "web":
          agent.withHttpTracing();
          agent.withResourceLeakMonitor(); // Catch Sockets
          agent.withInstrumentation({ autoPatching: true }); // Catch remote db calls
          break;
        case "db":
          agent.withQueryAnalysis(config.queryAnalysis ?? {});
          agent.withSlowQueryMonitor(config.slowQueries ?? {});
          agent.withInstrumentation({ autoPatching: true });
          agent.withResourceLeakMonitor(); // Catch Db connection leaks
          break;
        case "worker":
          agent.withRuntimeMonitor(); // Catch memory leaks/CPU hangs heavily
          agent.withGcMonitor();
          agent.withResourceLeakMonitor();
          agent.withInstrumentation({ autoPatching: true });
          break;
      }
    }

    // Always register graceful shutdown so buffered telemetry is flushed on SIGTERM/SIGINT.
    agent.withGracefulShutdown();

    return agent;
  }

  // ── chainable configuration methods ──────────────────────────

  /**
   * Enable source-map resolution for minified stack traces.
   * @param baseDir Root directory to scan for `.js` / `.js.map` files.
   */
  public withSourceMaps(baseDir: string = process.cwd()): this {
    this.sourceMapDir = baseDir;
    return this;
  }

  /**
   * Enable the runtime profiling monitor (event loop lag + memory leak detection).
   */
  public withRuntimeMonitor(options: RuntimeMonitorOptions = {}): this {
    this.monitorOptions = options;
    return this;
  }

  /**
   * Enable DB / IO instrumentation via diagnostics_channel hooks.
   * @param options Optional config for custom channels and auto-patching.
   */
  public withInstrumentation(options: InstrumentationOptions = {}): this {
    this.instrumentationOptions = options;
    return this;
  }

  /**
   * Configure the OTLP exporter (mTLS) for shipping telemetry.
   * Automatically enables the p99 aggregator.
   */
  public withExporter(config: ExporterConfig): this {
    this.exporterConfig = config;
    return this;
  }

  /**
   * Override the default aggregation sliding window (default: 60 000 ms).
   */
  public withAggregatorWindow(ms: number): this {
    this.aggregatorWindowMs = ms;
    return this;
  }

  /**
   * Override the Shannon entropy threshold (default: 4.0).
   */
  public withEntropyThreshold(threshold: number): this {
    this.entropyThreshold = threshold;
    return this;
  }

  /**
   * Enable SQL query structure analysis.
   * Automatically attaches fix suggestions to every traced query.
   */
  public withQueryAnalysis(options: QueryAnalyzerOptions = {}): this {
    this.queryAnalysisOptions = options;
    return this;
  }

  /**
   * Enable slow query monitoring. Queries that exceed their driver's threshold
   * are emitted as `'slow-query'` events and stored in a top-5 log accessible
   * via `agent.getSlowQueries()` / `agent.getSlowestQuery()`.
   *
   * Per-driver thresholds can be set via options or env vars:
   *   ARGUS_SLOW_QUERY_THRESHOLD_MS=1000       (global default)
   *   ARGUS_SLOW_QUERY_THRESHOLD_PG=500
   *   ARGUS_SLOW_QUERY_THRESHOLD_REDIS=50
   *   ARGUS_SLOW_QUERY_THRESHOLD_MONGODB=200
   *
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Very Low
   */
  public withSlowQueryMonitor(options: SlowQueryOptions = {}): this {
    this.slowQueryOptions = options;
    return this;
  }

  /**
   * Enable GC pressure monitoring. Fires 'gc-pressure' events when accumulated
   * GC pause time within a sliding window exceeds a configurable threshold.
   *
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Very Low
   */
  public withGcMonitor(options: GcMonitorOptions = {}): this {
    this.gcMonitorOptions = options;
    return this;
  }

  /**
   * Enable connection pool monitoring. Fires 'pool-exhaustion' and 'slow-acquire' events.
   * After calling this, register individual pool instances with `agent.watchPool(pool, driver)`.
   *
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Low
   */
  public withPoolMonitor(options: PoolMonitorOptions = {}): this {
    this.poolMonitorOptions = options;
    return this;
  }

  /**
   * Enable transaction duration monitoring. Fires 'transaction' events when a
   * BEGIN/COMMIT/ROLLBACK pattern is detected in traced queries.
   *
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Very Low
   */
  public withTransactionMonitor(options: TransactionMonitorOptions = {}): this {
    this.transactionMonitorOptions = options;
    return this;
  }

  /**
   * Enable cache hit-rate monitoring. Fires 'cache-degraded' when the hit rate
   * drops below the configured threshold in the sliding window.
   *
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Very Low
   */
  public withCacheMonitor(options: CacheMonitorOptions = {}): this {
    this.cacheMonitorOptions = options;
    return this;
  }

  /**
   * Enable DNS resolution monitoring. Fires 'dns' for every lookup and
   * 'slow-dns' when resolution exceeds the threshold.
   *
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Low
   */
  public withDnsMonitor(options: DnsMonitorOptions = {}): this {
    this.dnsMonitorOptions = options;
    return this;
  }

  /**
   * Enable adaptive sampling. Queries/HTTP events are sampled at the configured
   * rate to reduce overhead under high load.
   *
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Very Low
   */
  public withAdaptiveSampler(options: AdaptiveSamplerOptions = {}): this {
    this.adaptiveSamplerOptions = options;
    return this;
  }

  /**
   * Enable a one-time static code scan (TypeScript + ESLint) on startup.
   * Results are emitted as a 'scan' event.
   */
  public withStaticScanner(dir: string = process.cwd()): this {
    this.staticScanDir = dir;
    return this;
  }

  /**
   * Enable tracing for outgoing HTTP/HTTPS requests.
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Low-to-Medium
   */
  public withHttpTracing(): this {
    this.httpTracingEnabled = true;
    return this;
  }

  /**
   * Enable tracing for node:fs operations. Warns on synchronous blocking actions.
   * ❌ Prod Safe: No (Dev/Staging Only)
   * 📊 Resource Impact: High
   */
  public withFsTracing(): this {
    this.fsTracingEnabled = true;
    return this;
  }

  /**
   * Enable interception and secret scrubbing of console.log/info/warn/error.
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Low
   */
  public withLogTracing(options: LoggerOptions = {}): this {
    this.logTracingOptions = options;
    return this;
  }

  /**
   * Automatically detect and log node/npm environment vulnerabilities.
   * ❌ Prod Safe: No (Dev/Startup Only)
   * 📊 Resource Impact: High
   */
  public withAuditScanner(dir: string = process.cwd()): this {
    this.auditScanDir = dir;
    return this;
  }

  /**
   * Enable tracking of fatal errors (uncaught exceptions).
   * Ensures graceful telemetry flush before process exit.
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Very Low
   */
  public withCrashGuard(): this {
    this.crashGuardEnabled = true;
    return this;
  }

  /**
   * Track OS active resources/handles to catch TCP and file descriptor leaks.
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Low
   */
  public withResourceLeakMonitor(options: ResourceLeakMonitorOptions = {}): this {
    this.leakMonitorOptions = options;
    return this;
  }

  /**
   * Register SIGTERM/SIGINT handlers that flush telemetry before process exit.
   * Prevents data loss when the container scheduler terminates the process.
   * ✅ Prod Safe: Yes
   * 📊 Resource Impact: Negligible
   */
  public withGracefulShutdown(options: GracefulShutdownOptions = {}): this {
    this.gracefulShutdownOptions = options;
    return this;
  }

  // ── internal wiring helpers ───────────────────────────────────

  /**
   * Wires a tracker's event to both the aggregator and this agent's own emitter,
   * then enables it. Handles the repeated enable/record/passthrough pattern for
   * HTTP, FS, and Log trackers.
   *
   * @param tracker    The instrumentation instance (must have `enable()` and emit `trackerEvent`).
   * @param trackerEvent  The event name the tracker emits internally.
   * @param agentEvent    The event name re-emitted on this agent (also used as the aggregator key).
   */
  private wireTracker(
    tracker: EventEmitter & { enable(): void },
    trackerEvent: string,
    agentEvent: string,
  ): void {
    tracker.on(trackerEvent, (data: Record<string, unknown>) => {
      this.aggregator!.record(agentEvent, data.durationMs as number, data);
      this.emit(agentEvent, data);
    });
    tracker.enable();
  }

  // ── lifecycle ─────────────────────────────────────────────────

  /**
   * Initialise all configured subsystems, wire event bridges, and
   * begin monitoring. Returns `this` so the caller can still chain.
   */
  public async start(): Promise<this> {
    if (this.globallyDisabled || this.running) return this;

    if (process.env.DIAGNOSTIC_DEBUG === "true") {
      this.useConsoleLogger();
    }

    this.validateLicenseKey();
    await this.startInfrastructure();
    this.wireExporter();
    this.wireRuntimeMonitor();
    this.wireInstrumentationEngine();
    this.aggregator!.enable();
    this.wireTrackers();
    this.wireGuards();
    this.runStartupScans();
    this.registerGracefulShutdown();

    this.running = true;
    return this;
  }

  /** Step 0 — Validate license; fall back to free mode on any failure (never crash). */
  private validateLicenseKey(): void {
    const licenseKey = process.env.DIAGNOSTIC_LICENSE_KEY;
    if (!licenseKey) return;

    try {
      const claims = validateLicense(licenseKey);
      if (checkClockIntegrity(claims.tier, Date.now()) === "rollback") {
        this.emit(
          "error",
          new Error("DiagnosticAgent: system clock anomaly detected — running in free mode"),
        );
      } else {
        licenseClaims.set(this, claims);
        this.emit(
          "info",
          `DiagnosticAgent: tier=${claims.tier}, exp=${new Date(claims.exp * 1000).toISOString()}`,
        );
      }
    } catch (err) {
      if ((err as Error).message === "EXPIRED") {
        writeExpirySignal("Renew at: https://argus.dev/billing");
        this.emit(
          "info",
          "DiagnosticAgent: license expired — running in free mode. Renew at: https://argus.dev/billing",
        );
      } else {
        this.emit(
          "error",
          new Error(`DiagnosticAgent: invalid license — ${(err as Error).message}`),
        );
      }
    }
  }

  /** Steps 1–2 — Source-map resolver and metrics aggregator. */
  private async startInfrastructure(): Promise<void> {
    if (this.sourceMapDir) {
      this.resolver = new SourceMapResolver(this.sourceMapDir);
      await this.resolver.initialize();
    }
    this.aggregator = new MetricsAggregator(this.aggregatorWindowMs);
  }

  /** Step 3 — OTLP exporter wired to the aggregator's flush event. */
  private wireExporter(): void {
    if (!this.exporterConfig) return;

    this.exporter = new OTLPExporter(this.exporterConfig);
    const exporter = this.exporter;

    this.aggregator!.on("flush", (events: AggregatorEvent[]) => {
      void (async () => {
        const claims = licenseClaims.get(this) ?? null;
        const exportable = events.filter((e) => shouldExport(e.metricName, claims));
        if (exportable.length === 0) return;

        const threshold = this.entropyThreshold;
        const scrubbed = exportable.map((e) => ({
          ...e,
          payload: JSON.parse(
            EntropyChecker.scrubHighEntropyStrings(JSON.stringify(e.payload), threshold),
          ) as Record<string, unknown>,
        }));

        try {
          await exporter.export(scrubbed);
        } catch (err) {
          this.emit("error", err);
        }
      })();
    });
  }

  /** Step 4 — Runtime monitor (event-loop lag + memory anomalies). */
  private wireRuntimeMonitor(): void {
    if (!this.monitorOptions) return;

    this.monitor = new RuntimeMonitor(this.monitorOptions);
    const aggregator = this.aggregator!;

    this.monitor.on("anomaly", (event: ProfilerEvent) => {
      aggregator.record(
        event.type,
        event.lagMs ?? event.growthBytes ?? 0,
        event as unknown as Record<string, unknown>,
      );
      this.emit("anomaly", event);
    });
    this.monitor.on("error", (err) => this.emit("error", err));
    this.monitor.start();
  }

  /** Steps 5–5b — Instrumentation engine + query analyzer + slow query monitor + analysis monitors. */
  private wireInstrumentationEngine(): void {
    if (this.queryAnalysisOptions !== null) {
      this.queryAnalyzer = new QueryAnalyzer(this.queryAnalysisOptions);
    }

    if (this.slowQueryOptions !== null) {
      this.slowQueryMonitor = new SlowQueryMonitor(this.slowQueryOptions);
    }

    if (this.adaptiveSamplerOptions !== null) {
      this.adaptiveSampler = new AdaptiveSampler(this.adaptiveSamplerOptions);
    }

    if (!this.instrumentationOptions) return;

    if (this.instrumentationOptions.autoPatching) {
      applyDriverPatches();
    }

    this.engine = new InstrumentationEngine(this.instrumentationOptions);
    const aggregator = this.aggregator!;

    this.engine.on("query", (traced: TracedQuery) => {
      // Adaptive sampling — drop event if bucket is empty
      if (this.adaptiveSampler && !this.adaptiveSampler.shouldSample("query")) return;

      const enriched = this.queryAnalyzer
        ? { ...traced, suggestions: this.queryAnalyzer.analyze(traced.sanitizedQuery) }
        : traced;

      if (this.slowQueryMonitor && traced.driver) {
        const slow = this.slowQueryMonitor.check(
          traced.sanitizedQuery,
          traced.durationMs,
          traced.driver,
          traced.timestamp,
          traced.sourceLine,
          traced.correlationId,
          traced.traceId,
        );
        if (slow) {
          aggregator.record(
            "slow-query",
            slow.durationMs,
            slow as unknown as Record<string, unknown>,
          );
          this.emit("slow-query", slow);
        }
      }

      aggregator.record("query", traced.durationMs, enriched as Record<string, unknown>);
      this.emit("query", enriched);
    });

    this.engine.enable();

    // Attach analysis monitors that subscribe to the engine's query events
    if (this.transactionMonitorOptions !== null) {
      this.transactionMonitor = new TransactionMonitor(this.transactionMonitorOptions);
      this.transactionMonitor.attach(this.engine);
      this.transactionMonitor.on("transaction", (event: TransactionEvent) => {
        aggregator.record(
          "transaction",
          event.durationMs,
          event as unknown as Record<string, unknown>,
        );
        this.emit("transaction", event);
      });
    }

    if (this.cacheMonitorOptions !== null) {
      this.cacheMonitor = new CacheMonitor(this.cacheMonitorOptions);
      this.cacheMonitor.attach(this.engine);
      this.cacheMonitor.on("cache-degraded", (event) => {
        aggregator.record(
          "cache-degraded",
          event.hitRate,
          event as unknown as Record<string, unknown>,
        );
        this.emit("cache-degraded", event);
      });
    }
  }

  /** Steps 8–10 — HTTP, FS, log, and DNS trackers. */
  private wireTrackers(): void {
    if (this.httpTracingEnabled) {
      this.httpTracker = new HttpInstrumentation(() => this.engine?.extractSourceLine());
      this.wireTracker(this.httpTracker, "request", "http");
    }

    if (this.fsTracingEnabled) {
      this.fsTracker = new FsInstrumentation(() => this.engine?.extractSourceLine());
      this.wireTracker(this.fsTracker, "fs", "fs");
    }

    if (this.logTracingOptions) {
      this.logTracingOptions.entropyThreshold ??= this.entropyThreshold;
      this.logTracker = new LoggerInstrumentation(
        () => this.engine?.extractSourceLine(),
        this.logTracingOptions,
      );
      this.wireTracker(this.logTracker, "log", "log");
    }

    if (this.dnsMonitorOptions !== null) {
      this.dnsMonitor = new DnsMonitor(this.dnsMonitorOptions);
      this.dnsMonitor.on("dns", (event) => {
        this.aggregator!.record(
          "dns",
          event.durationMs,
          event as unknown as Record<string, unknown>,
        );
        this.emit("dns", event);
      });
      this.dnsMonitor.on("slow-dns", (event) => {
        this.aggregator!.record(
          "slow-dns",
          event.durationMs,
          event as unknown as Record<string, unknown>,
        );
        this.emit("slow-dns", event);
      });
      this.dnsMonitor.enable();
    }
  }

  /** Steps 11–13 — Crash guard, resource-leak monitor, GC monitor, pool monitor. */
  private wireGuards(): void {
    if (this.crashGuardEnabled) {
      this.crashGuard = new CrashGuard(
        (stack) => stack,
        () => this.stop(), // flush telemetry before process.exit(1)
      );
      this.crashGuard.on("crash", (event) => this.emit("crash", event));
      this.crashGuard.enable();
    }

    if (this.leakMonitorOptions) {
      this.leakMonitor = new ResourceLeakMonitor(this.leakMonitorOptions);
      this.leakMonitor.on("leak", (event) => this.emit("leak", event));
      this.leakMonitor.start();
    }

    if (this.gcMonitorOptions !== null) {
      this.gcMonitor = new GcMonitor(this.gcMonitorOptions);
      this.gcMonitor.on("gc-pressure", (event: GcPressureEvent) => {
        this.aggregator!.record(
          "gc-pressure",
          event.totalPauseMs,
          event as unknown as Record<string, unknown>,
        );
        this.emit("gc-pressure", event);
      });
      this.gcMonitor.start();
    }

    if (this.poolMonitorOptions !== null) {
      this.poolMonitor = new PoolMonitor(this.poolMonitorOptions);
      this.poolMonitor.on("pool-exhaustion", (event: PoolExhaustionEvent) => {
        this.aggregator!.record(
          "pool-exhaustion",
          event.waitingCount,
          event as unknown as Record<string, unknown>,
        );
        this.emit("pool-exhaustion", event);
      });
      this.poolMonitor.on("slow-acquire", (event: SlowAcquireEvent) => {
        this.aggregator!.record(
          "slow-acquire",
          event.waitMs,
          event as unknown as Record<string, unknown>,
        );
        this.emit("slow-acquire", event);
      });
    }
  }

  /** Steps 7 + 13 — Fire-and-forget static and audit scans. */
  private runStartupScans(): void {
    if (this.staticScanDir) {
      new StaticScanner(this.staticScanDir)
        .scan()
        .then((results) => this.emit("scan", results))
        .catch((err) => this.emit("error", err));
    }

    if (this.auditScanDir) {
      new AuditScanner(this.auditScanDir)
        .scan()
        .then((result) => {
          if (result) this.emit("audit", result);
        })
        .catch((err) => this.emit("error", err));
    }
  }

  /** Step 14 — Register SIGTERM/SIGINT graceful-shutdown handlers. */
  private registerGracefulShutdown(): void {
    if (this.gracefulShutdownOptions !== null) {
      new GracefulShutdown().register(this, this.gracefulShutdownOptions);
    }
  }

  /**
   * Gracefully tear down every subsystem.
   * Returns a Promise so callers (e.g. GracefulShutdown) can await flush completion.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async stop(): Promise<void> {
    if (this.globallyDisabled || !this.running) return;

    if (this.engine) this.engine.disable();
    if (this.monitor) this.monitor.stop();
    if (this.httpTracker) this.httpTracker.disable();
    if (this.fsTracker) this.fsTracker.disable();
    if (this.logTracker) this.logTracker.disable();
    if (this.crashGuard) this.crashGuard.disable();
    if (this.leakMonitor) this.leakMonitor.stop();

    this.aggregator?.disable(); // flushes remaining buffer
    this.resolver?.destroy();

    if (this.instrumentationOptions?.autoPatching) {
      removeDriverPatches(); // restore original prototypes
    }

    this.engine = null;
    this.monitor = null;
    this.aggregator = null;
    this.resolver = null;
    this.exporter = null;
    this.httpTracker = null;
    this.fsTracker = null;
    this.logTracker = null;
    this.crashGuard = null;
    this.leakMonitor = null;
    this.queryAnalyzer = null;
    this.slowQueryMonitor = null;
    if (this.gcMonitor) {
      this.gcMonitor.stop();
      this.gcMonitor = null;
    }
    if (this.poolMonitor) {
      this.poolMonitor.stop();
      this.poolMonitor = null;
    }
    if (this.transactionMonitor) {
      this.transactionMonitor.stop();
      this.transactionMonitor = null;
    }
    if (this.cacheMonitor) {
      this.cacheMonitor.stop();
      this.cacheMonitor = null;
    }
    if (this.dnsMonitor) {
      this.dnsMonitor.disable();
      this.dnsMonitor = null;
    }
    this.adaptiveSampler = null;

    // Remove debug console listeners added by useConsoleLogger (if any).
    for (const [event, fn] of this.debugListeners) {
      this.off(event, fn);
    }
    this.debugListeners = [];

    this.running = false;
  }

  // ── built-in console logger ───────────────────────────────────

  /**
   * Internal only — called automatically when DIAGNOSTIC_DEBUG=true.
   *
   * @param prefix  Log prefix (default: `[DiagAgent]`)
   * @param level   `'warn'` — anomalies/crashes/errors only (default)
   *                `'verbose'` — also logs every query and HTTP request
   */
  private useConsoleLogger(prefix = "[DiagAgent]", level: "warn" | "verbose" = "verbose"): this {
    const add = (event: string, fn: (...args: unknown[]) => void) => {
      this.on(event, fn);
      this.debugListeners.push([event, fn]);
    };

    add("anomaly", (a) => {
      const ev = a as { type: string };
      console.warn(`${prefix} ANOMALY type=${ev.type}`, a);
    });
    add("leak", (l) => {
      const ev = l as { handlesCount: number };
      console.warn(`${prefix} LEAK    handles=${ev.handlesCount}`);
    });
    add("crash", (c) => {
      const ev = c as { error?: Error };
      console.error(`${prefix} CRASH   ${ev.error?.message ?? String(c)}`);
    });
    add("error", (e) => {
      const ev = e as Error | undefined;
      console.error(`${prefix} ERROR   ${ev?.message ?? String(e)}`);
    });
    add("info", (m) => {
      console.info(`${prefix} INFO    ${String(m)}`);
    });
    add("log", (l) => {
      const ev = l as { scrubbed: boolean; level: string };
      if (ev.scrubbed)
        console.warn(`${prefix} SCRUB   console.${ev.level} contained secrets — redacted`);
    });
    add("slow-query", (s) => {
      const ev = s as SlowQueryRecord;
      console.warn(
        `${prefix} SLOW    [${ev.durationMs.toFixed(1)}ms > ${ev.thresholdMs}ms] driver=${ev.driver} — ${ev.sanitizedQuery}`,
      );
    });
    add("gc-pressure", (g) => {
      const ev = g as GcPressureEvent;
      console.warn(
        `${prefix} GC      [${ev.totalPauseMs.toFixed(1)}ms | ${ev.pausePct.toFixed(1)}% of ${ev.windowMs}ms window] ${ev.gcCount} cycles`,
      );
    });
    add("pool-exhaustion", (p) => {
      const ev = p as PoolExhaustionEvent;
      console.warn(
        `${prefix} POOL    [${ev.driver}] waiting=${ev.waitingCount} idle=${ev.idleCount} total=${ev.totalCount}`,
      );
    });
    add("slow-acquire", (s) => {
      const ev = s as SlowAcquireEvent;
      console.warn(`${prefix} POOL    [${ev.driver}] slow acquire ${ev.waitMs.toFixed(0)}ms`);
    });

    if (level === "verbose") {
      add("query", (q) => {
        const ev = q as {
          durationMs: number;
          sanitizedQuery: string;
          suggestions?: { message: string }[];
        };
        const hints = ev.suggestions?.map((s) => s.message).join(" | ");
        const suffix = hints ? `\n  ⚠ ${hints}` : "";
        console.log(
          `${prefix} QUERY   [${ev.durationMs.toFixed(1)}ms] ${ev.sanitizedQuery}${suffix}`,
        );
      });
      add("http", (r) => {
        const ev = r as { method: string; url: string; statusCode?: number; durationMs: number };
        console.log(
          `${prefix} HTTP    ${ev.method} ${ev.url} → ${ev.statusCode ?? "---"} (${ev.durationMs.toFixed(1)}ms)`,
        );
      });
    }

    return this;
  }

  // ── convenience accessors ─────────────────────────────────────

  /** Returns `true` if the agent has been started and not yet stopped. */
  public get isRunning(): boolean {
    return this.running;
  }

  /**
   * Returns the top-N slowest queries recorded since the agent started (or last `clearSlowQueries()` call),
   * sorted slowest first. Returns an empty array if slow query monitoring is not enabled.
   */
  public getSlowQueries(): SlowQueryRecord[] {
    return this.slowQueryMonitor?.getSlowQueries() ?? [];
  }

  /**
   * Returns the single slowest query recorded, or undefined if none yet (or monitoring disabled).
   */
  public getSlowestQuery(): SlowQueryRecord | undefined {
    return this.slowQueryMonitor?.getSlowest();
  }

  /**
   * Clears the slow query log. Useful at the start of a request or test scenario.
   */
  public clearSlowQueries(): void {
    this.slowQueryMonitor?.clear();
  }

  /**
   * Register a connection pool for monitoring. Requires `withPoolMonitor()` to have been
   * called before `start()`. Safe to call after start — the pool is watched immediately.
   *
   * @param pool    A pg.Pool, mysql2 pool, or any PoolLike instance.
   * @param driver  Driver name (e.g. 'pg', 'mysql2') used in emitted events.
   */
  public watchPool(pool: PoolLike, driver: string): this {
    if (this.poolMonitor) {
      this.poolMonitor.watch(pool, driver);
    }
    return this;
  }

  /**
   * Returns a Connect-compatible middleware that reads the incoming `traceparent` header
   * and runs the request inside a `RequestContext` so all queries and HTTP calls within
   * the same async call chain carry the same `traceId`.
   *
   * Compatible with Express, Fastify (with express-compat), Koa-connect, and raw Node HTTP.
   *
   * @example
   * ```ts
   * app.use(agent.createMiddleware());
   * ```
   */
  public createMiddleware(): (
    req: { headers: Record<string, string | string[] | undefined>; method?: string; url?: string },
    res: unknown,
    next: () => void,
  ) => void {
    return (req, _res, next) => {
      const ctx = createRequestContext(req.method, req.url, req.headers.traceparent);
      runWithContext(ctx, next);
    };
  }

  /**
   * Creates and returns a `RequestContext` for manual use (e.g. background jobs, queue workers).
   * Pass the returned context to `runWithContext(ctx, fn)` to propagate tracing.
   */
  public createContext(method?: string, url?: string, traceparent?: string): RequestContext {
    return createRequestContext(method, url, traceparent);
  }

  /**
   * Manually trace a query (delegates to InstrumentationEngine.traceQuery).
   * Only available when instrumentation is enabled.
   */
  public async traceQuery<T>(query: string, executeFn: () => Promise<T>): Promise<T> {
    if (!this.engine) {
      throw new Error(
        "Instrumentation is not enabled. Call .withInstrumentation() before .start().",
      );
    }
    return this.engine.traceQuery(query, executeFn);
  }

  /**
   * Resolve a minified position back to original source.
   * Only available when source maps are enabled.
   */
  public async resolvePosition(filePath: string, line: number, column: number) {
    if (!this.resolver) {
      throw new Error("Source maps are not enabled. Call .withSourceMaps() before .start().");
    }
    return this.resolver.resolvePosition(filePath, line, column);
  }
}
