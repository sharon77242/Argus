import { EventEmitter } from 'node:events';
import { SourceMapResolver } from './profiling/source-map-resolver.ts';
import { RuntimeMonitor, type RuntimeMonitorOptions, type ProfilerEvent } from './profiling/runtime-monitor.ts';
import { InstrumentationEngine, type TracedQuery, type InstrumentationOptions } from './instrumentation/engine.ts';
import { MetricsAggregator, type AggregatorEvent } from './export/aggregator.ts';
import { OTLPExporter, type ExporterConfig } from './export/exporter.ts';
import { EntropyChecker } from './sanitization/entropy-checker.ts';
import { applyDriverPatches, removeDriverPatches } from './instrumentation/drivers/index.ts';
import { QueryAnalyzer } from './analysis/query-analyzer.ts';
import { StaticScanner } from './analysis/static-scanner.ts';
import { HttpInstrumentation, type TracedHttpRequest } from './instrumentation/http.ts';
import { FsInstrumentation, type TracedFsOperation } from './instrumentation/fs.ts';
import { LoggerInstrumentation, type LoggerOptions, type TracedLog } from './instrumentation/logger.ts';
import { CrashGuard, type CrashEvent } from './profiling/crash-guard.ts';
import { ResourceLeakMonitor, type ResourceLeakMonitorOptions, type ResourceLeakEvent } from './profiling/resource-leak-monitor.ts';
import { AuditScanner } from './analysis/audit-scanner.ts';
import { detectAppTypes, type DetectionResult } from './profiling/app-type-detector.ts';

export type AppType = 'web' | 'db' | 'worker';

export interface AgentProfileConfig {
  enabled?: boolean;
  environment?: 'dev' | 'test' | 'prod';
  appType?: 'auto' | AppType | AppType[];
  workspaceDir?: string;
}

/**
 * High-level fluent builder for the Deep Diagnostic Agent.
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
  private queryAnalysisEnabled = false;
  private staticScanDir: string | null = null;
  private httpTracingEnabled = false;
  private fsTracingEnabled = false;
  private logTracingOptions: LoggerOptions | null = null;
  private crashGuardEnabled = false;
  private leakMonitorOptions: ResourceLeakMonitorOptions | null = null;
  private auditScanDir: string | null = null;

  // ── live instances (created on .start()) ──
  private resolver: SourceMapResolver | null = null;
  private monitor: RuntimeMonitor | null = null;
  private engine: InstrumentationEngine | null = null;
  private aggregator: MetricsAggregator | null = null;
  private exporter: OTLPExporter | null = null;
  private queryAnalyzer: QueryAnalyzer | null = null;
  private httpTracker: HttpInstrumentation | null = null;
  private fsTracker: FsInstrumentation | null = null;
  private logTracker: LoggerInstrumentation | null = null;
  private crashGuard: CrashGuard | null = null;
  private leakMonitor: ResourceLeakMonitor | null = null;

  private running = false;

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
    const isGloballyDisabled = envEnabled !== undefined 
      ? envEnabled === 'false' || envEnabled === '0'
      : config.enabled === false;

    if (isGloballyDisabled) {
      agent.globallyDisabled = true;
      return agent;
    }

    const env = config.environment ?? 'prod';

    // Resolve app types — 'auto' triggers package.json scanning
    let appTypes: AppType[];
    const selectedType = config.appType ?? 'auto';
    if (selectedType === 'auto') {
      const detected = detectAppTypes(config.workspaceDir);
      if (detected.types.length > 0) {
        appTypes = detected.types;
      } else {
        // No recognized packages found — don’t silently assume 'web'.
        // Emit a dev-time notice and apply no app-type-specific modules.
        appTypes = [];
        if (env !== 'prod') {
          // Delay to after construction so listeners can attach
        setImmediate(() => { agent.emit('info',
            'DiagnosticAgent: auto-detection found no recognized app type in package.json. ' +
            'Pass appType explicitly ("web" | "db" | "worker") to enable app-specific monitoring.'
          ); });
        }
      }
    } else {
      appTypes = Array.isArray(selectedType) ? selectedType : [selectedType];
    }

    // 1. Universal Production Safe Bindings
    agent.withCrashGuard();
    agent.withLogTracing();

    // 2. Dev/Test Scanners (Non-Prod)
    if (env === 'dev' || env === 'test') {
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
        case 'web':
          agent.withHttpTracing();
          agent.withResourceLeakMonitor(); // Catch Sockets
          agent.withInstrumentation({ autoPatching: true }); // Catch remote db calls
          break;
        case 'db':
          agent.withQueryAnalysis();
          agent.withInstrumentation({ autoPatching: true });
          agent.withResourceLeakMonitor(); // Catch Db connection leaks
          break;
        case 'worker':
          agent.withRuntimeMonitor(); // Catch memory leaks/CPU hangs heavily
          agent.withResourceLeakMonitor();
          agent.withInstrumentation({ autoPatching: true });
          break;
      }
    }

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
  public withQueryAnalysis(): this {
    this.queryAnalysisEnabled = true;
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

  // ── lifecycle ─────────────────────────────────────────────────

  /**
   * Initialise all configured subsystems, wire event bridges, and
   * begin monitoring. Returns `this` so the caller can still chain.
   */
  public async start(): Promise<this> {
    if (this.globallyDisabled || this.running) return this;

    if (process.env.DIAGNOSTIC_DEBUG === 'true') {
      this.useConsoleLogger();
    }

    // 1. Source maps
    if (this.sourceMapDir) {
      this.resolver = new SourceMapResolver(this.sourceMapDir);
      await this.resolver.initialize();
    }

    // 2. Aggregator (always created — acts as central event bus)
    this.aggregator = new MetricsAggregator(this.aggregatorWindowMs);

    // 3. Exporter
    if (this.exporterConfig) {
      this.exporter = new OTLPExporter(this.exporterConfig);
      const exporter = this.exporter;
      const aggregator = this.aggregator;

      aggregator.on('flush', (events: AggregatorEvent[]) => {
        void (async () => {
          const scrubbed = events.map(e => ({
            ...e,
            payload: typeof e.payload === 'string'
              ? EntropyChecker.scrubHighEntropyStrings(e.payload, this.entropyThreshold)
              : e.payload,
          }));

          try {
            await exporter.export(scrubbed);
          } catch (err) {
            this.emit('error', err);
          }
        })();
      });
    }

    // 4. Runtime monitor
    if (this.monitorOptions) {
      this.monitor = new RuntimeMonitor(this.monitorOptions);
      const aggregator = this.aggregator;

      this.monitor.on('anomaly', (event: ProfilerEvent) => {
        aggregator.record(event.type, event.lagMs ?? event.growthBytes ?? 0, event);
        this.emit('anomaly', event); // passthrough for user listeners
      });

      this.monitor.on('error', (err) => this.emit('error', err));
      this.monitor.start();
    }

    // 5. Instrumentation engine
    if (this.instrumentationOptions) {
      // Apply driver auto-patching before enabling the engine
      if (this.instrumentationOptions.autoPatching) {
        applyDriverPatches();
      }

      this.engine = new InstrumentationEngine(this.instrumentationOptions);
      const aggregator = this.aggregator;

      this.engine.on('query', (traced: TracedQuery) => {
        // Enrich with fix suggestions if query analysis is enabled
        const enriched = this.queryAnalyzer
          ? { ...traced, suggestions: this.queryAnalyzer.analyze(traced.sanitizedQuery) }
          : traced;

        aggregator.record('query', traced.durationMs, enriched);
        this.emit('query', enriched); // passthrough
      });

      this.engine.enable();
    }

    // 5b. Query analyzer (works even without instrumentation for manual traceQuery)
    if (this.queryAnalysisEnabled) {
      this.queryAnalyzer = new QueryAnalyzer();
    }

    // 6. Start the aggregator flush timer
    this.aggregator.enable();

    // 7. Static scan (fire-and-forget on startup)
    if (this.staticScanDir) {
      const scanner = new StaticScanner(this.staticScanDir);
      scanner.scan().then((results) => {
        this.emit('scan', results);
      }).catch((err) => {
        this.emit('error', err);
      });
    }

    // 8. HTTP Tracing
    if (this.httpTracingEnabled) {
      this.httpTracker = new HttpInstrumentation(() => this.engine?.extractSourceLine());
      const aggregator = this.aggregator;
      this.httpTracker.on('request', (req: TracedHttpRequest) => {
        aggregator.record('http', req.durationMs, req);
        this.emit('http', req);
      });
      this.httpTracker.enable();
    }

    // 9. File System Tracing
    if (this.fsTracingEnabled) {
      this.fsTracker = new FsInstrumentation(() => this.engine?.extractSourceLine());
      const aggregator = this.aggregator;
      this.fsTracker.on('fs', (op: TracedFsOperation) => {
        aggregator.record('fs', op.durationMs, op);
        this.emit('fs', op);
      });
      this.fsTracker.enable();
    }

    // 10. Logger Tracing
    if (this.logTracingOptions) {
      // Pass the configured entropy override to the logger options if not provided
      this.logTracingOptions.entropyThreshold ??= this.entropyThreshold;
      this.logTracker = new LoggerInstrumentation(() => this.engine?.extractSourceLine(), this.logTracingOptions);
      const aggregator = this.aggregator;
      this.logTracker.on('log', (log: TracedLog) => {
        aggregator.record('log', log.durationMs, log);
        this.emit('log', log);
      });
      this.logTracker.enable();
    }

    // 11. Crash Guard
    if (this.crashGuardEnabled) {
      this.crashGuard = new CrashGuard((stack) => stack);
      this.crashGuard.on('crash', (event: CrashEvent) => {
        this.emit('crash', event);
      });
      this.crashGuard.enable();
    }

    // 12. Resource Leak Monitor
    if (this.leakMonitorOptions) {
      this.leakMonitor = new ResourceLeakMonitor(this.leakMonitorOptions);
      this.leakMonitor.on('leak', (event: ResourceLeakEvent) => {
        this.emit('leak', event);
      });
      this.leakMonitor.start();
    }

    // 13. Audit Scanner
    if (this.auditScanDir) {
      const auditScanner = new AuditScanner(this.auditScanDir);
      auditScanner.scan().then((result) => {
        if (result) this.emit('audit', result);
      }).catch((err) => {
        this.emit('error', err);
      });
    }

    this.running = true;
    return this;
  }

  /**
   * Gracefully tear down every subsystem.
   */
  public stop(): void {
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
  private useConsoleLogger(prefix = '[DiagAgent]', level: 'warn' | 'verbose' = 'verbose'): this {
    this.on('anomaly', (a) => console.warn(`${prefix} ANOMALY type=${a.type}`, a));
    this.on('leak',    (l) => console.warn(`${prefix} LEAK    handles=${l.handlesCount}`));
    this.on('crash',   (c) => console.error(`${prefix} CRASH   ${c.error?.message ?? c}`));
    this.on('error',   (e) => console.error(`${prefix} ERROR   ${e?.message ?? e}`));
    this.on('info',    (m) => console.info(`${prefix} INFO    ${m}`));
    this.on('log',     (l) => { if (l.scrubbed) console.warn(`${prefix} SCRUB   console.${l.level} contained secrets — redacted`); });

    if (level === 'verbose') {
      this.on('query', (q) => {
        const hints = q.suggestions?.map((s: { message: string }) => s.message).join(' | ');
        const suffix = hints ? `\n  ⚠ ${hints}` : '';
        console.log(`${prefix} QUERY   [${q.durationMs.toFixed(1)}ms] ${q.sanitizedQuery}${suffix}`);
      });
      this.on('http',  (r) => console.log(`${prefix} HTTP    ${r.method} ${r.url} → ${r.statusCode ?? '---'} (${r.durationMs.toFixed(1)}ms)`));
    }

    return this;
  }


  // ── convenience accessors ─────────────────────────────────────


  /** Returns `true` if the agent has been started and not yet stopped. */
  public get isRunning(): boolean {
    return this.running;
  }

  /**
   * Manually trace a query (delegates to InstrumentationEngine.traceQuery).
   * Only available when instrumentation is enabled.
   */
  public async traceQuery<T>(query: string, executeFn: () => Promise<T>): Promise<T> {
    if (!this.engine) {
      throw new Error('Instrumentation is not enabled. Call .withInstrumentation() before .start().');
    }
    return this.engine.traceQuery(query, executeFn);
  }

  /**
   * Resolve a minified position back to original source.
   * Only available when source maps are enabled.
   */
  public async resolvePosition(filePath: string, line: number, column: number) {
    if (!this.resolver) {
      throw new Error('Source maps are not enabled. Call .withSourceMaps() before .start().');
    }
    return this.resolver.resolvePosition(filePath, line, column);
  }
}
