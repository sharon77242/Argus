# Contributing to Argus

Thank you for your interest in contributing. This guide covers everything you need to get the codebase running, understand its structure, and submit a quality pull request.

---

## Requirements

| Tool | Version |
|---|---|
| Node.js | ≥ 22.6.0 (source/dev mode requires `--experimental-strip-types`) |
| pnpm | ≥ 8 |

## Setup

```bash
git clone <repo>
pnpm install          # installs all workspace packages
```

## Running tests

```bash
# From the repo root — runs all packages
pnpm test

# Or for the agent package only
cd packages/agent
pnpm test
```

Tests use Node's built-in `node:test` runner with `--experimental-strip-types` so TypeScript files run directly — no compile step needed for development.

## Building

```bash
cd packages/agent
pnpm build            # builds both ESM and CJS outputs → dist/
pnpm build:esm        # ESM only (dist/esm/)
pnpm build:cjs        # CJS only (dist/cjs/)
```

## Type checking and linting

```bash
cd packages/agent
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint using typescript-eslint recommendedTypeChecked
pnpm lint:fix         # auto-fix what's fixable
```

---

## Architecture

The agent is structured in five layers:

```
DiagnosticAgent (fluent builder + event bus)
  │
  ├── Profiling          — runtime observation, crash interception, source maps
  │     RuntimeMonitor    event-loop lag, heap growth (accumulated model)
  │     CrashGuard        uncaughtException → flush telemetry → process.exit(1)
  │     SourceMapResolver lazy .js.map scanner; resolves minified stack positions
  │     ResourceLeakMonitor  OS handle count via process.getActiveResourcesInfo
  │     GracefulShutdown  SIGTERM/SIGINT → agent.stop() → process.exit(0)
  │
  ├── Instrumentation    — intercept DB/HTTP/FS/console activity
  │     InstrumentationEngine  diagnostics_channel subscriber for 16 DB drivers
  │     16 DB driver patches   pg, mysql2, mongodb, mssql, sqlite, prisma, …
  │     HttpInstrumentation    Node 18+ via channel; Node 14-17 monkey-patch
  │     FsInstrumentation      patches fs.* for sync-blocker detection (DEV only)
  │     LoggerInstrumentation  console.* override + entropy scrubbing
  │
  ├── Sanitization       — privacy firewall (always active)
  │     AstSanitizer     SQL/NoSQL value stripping at the AST layer
  │     EntropyChecker   Shannon entropy scan; redacts JWTs, API keys, tokens
  │
  ├── Analysis           — pattern detection and fix suggestions
  │     QueryAnalyzer    N+1 detection (sliding window), missing WHERE, no-SELECT-*
  │     StaticScanner    TypeScript Compiler API + ESLint (DEV/CI only)
  │     AuditScanner     npm audit CVE scanning (DEV/CI only)
  │     Fs/Http/LogAnalyzers  domain-specific rule sets
  │
  └── Export             — aggregate and ship
        MetricsAggregator  p99 sliding-window deduplication
        OTLPExporter       OTLP JSON over mTLS (optional; no export = local events only)
```

All data flows top-to-bottom. The sanitization layer sits between instrumentation and export; nothing leaves the process without passing through `AstSanitizer` + `EntropyChecker`.

---

## Key design decisions

### diagnostics_channel over monkey-patching

DB driver interception uses `node:diagnostics_channel` (the official Node.js observability primitive) rather than patching prototypes at require-time. This means:
- Zero risk of prototype pollution.
- Patches publish timing to a named channel; the agent subscribes. Drivers that don't publish can still be patched manually via `patchMethod`.
- On Node 14–17, HTTP interception automatically falls back to a monkey-patch of `http.request`.

### Accumulated memory growth model

`RuntimeMonitor` uses an *accumulated* growth baseline rather than a per-tick delta:
- A tick that grows heap by any positive amount increments `consecutiveGrowthTicks`.
- The counter resets only when heap *decreases* (GC ran).
- An anomaly fires when `consecutiveGrowthTicks >= 3` **and** `currentHeap - baseline > threshold`.
- This catches both sudden spikes (3 × 5 MB = 15 MB in 3 s) and slow-burn leaks (3 × 2 MB/min).

### CrashGuard flush before process.exit

When `DiagnosticAgent.wireGuards()` creates `CrashGuard`, it passes `() => this.stop()` as the `beforeExit` callback. On an `uncaughtException`:
1. The crash event is emitted synchronously (in-process listeners get it).
2. `beforeExit()` is awaited (max 2 s) so the OTLP exporter can flush.
3. `process.exit(1)` runs only after the flush or the deadline, whichever comes first.
`unhandledRejection` never calls `process.exit` — Node ≥ 15 treats it as recoverable.

### No `any` in source files

Source files (`src/`) enforce strict TypeScript. The ESLint config applies `recommendedTypeChecked` with `no-explicit-any: error`. Test files get a blanket suppression because mocking private fields requires `as any` casts — that suppression is scoped to `tests/**` only.

---

## Adding a new DB driver

1. Create `packages/agent/src/instrumentation/drivers/<name>.ts`.
2. Export a `patch<Name>(): boolean` function that calls `patchMethod(proto, methodName, '<name>')` for each method you want to trace.
3. Register it in `packages/agent/src/instrumentation/drivers/index.ts` inside `applyDriverPatches()`.
4. Add tests in `packages/agent/tests/instrumentation/drivers-all-coverage.test.ts` using the existing `mockNodeRequire` pattern.
5. Register a default slow-query threshold in `DRIVER_DEFAULTS` inside `packages/agent/src/analysis/slow-query-monitor.ts`. Use the driver's typical p99 latency as a guide — in-memory stores warrant ≤ 50 ms, local-disk stores ≤ 100 ms, OLTP drivers ≤ 500 ms, analytics engines ≥ 5000 ms. If you skip this step, a `process.emitWarning` will fire in non-production environments the first time the driver is seen.

---

## Submitting a pull request

1. Fork the repo and create a feature branch from `main`.
2. Make your changes; add or update tests.
3. Run `pnpm test && pnpm typecheck && pnpm lint` — all must pass.
4. Open a PR with a clear description of what you changed and why.
5. Reference any related issue numbers in the PR description.

For large changes, open an issue first to discuss the approach before writing code.

---

## Monitoring roadmap

This section tracks planned monitoring capabilities — what's already shipped, what's next, and what the bigger ideas are. If you want to contribute one, open an issue and reference the item.

### Shipped

| Feature | Module | Notes |
|---|---|---|
| Event-loop lag detection | `RuntimeMonitor` | Fires `anomaly` when lag > threshold |
| Memory leak detection | `RuntimeMonitor` | Accumulated-growth model (3 consecutive ticks) |
| Crash telemetry flush | `CrashGuard` | `uncaughtException` → flush → `exit(1)` |
| OS handle / TCP leak detection | `ResourceLeakMonitor` | `process.getActiveResourcesInfo()` delta |
| DB query tracing (16 drivers) | `InstrumentationEngine` + driver patches | Via `diagnostics_channel` |
| N+1 / missing-WHERE / no-SELECT-* | `QueryAnalyzer` | Sliding-window N+1 heuristic |
| **Slow query monitoring** | `SlowQueryMonitor` | Per-driver thresholds, env-var overrides, top-5 log |
| HTTP request tracing | `HttpInstrumentation` | Timing, status code, source line |
| FS sync-blocker detection | `FsInstrumentation` | Dev/staging only |
| Secret scrubbing (console + export) | `EntropyChecker` + `LoggerInstrumentation` | Shannon entropy threshold |
| Static code scan | `StaticScanner` | TypeScript Compiler API + ESLint, startup only |
| npm CVE audit | `AuditScanner` | Startup only |
| Worker thread queue depth | `WorkerThreadsMonitor` | Queue depth and slow-task anomalies |
| Stream leak detection | `StreamLeakDetector` | Readable streams never consumed |
| Slow `require()` detection | `SlowRequireDetector` | `diagnostics_channel` `module.cjs.load.*` |

---

### Near-term (low effort, high value)

**Connection pool monitoring**
Track the time queries spend waiting for a pool slot separately from query execution time. Surface pool saturation (`waiting > N`) as a distinct event. Most pg/mysql2 pool libraries already emit events — wire a `patchPool(pool)` helper that subscribes to `acquire`, `release`, and `remove`.

**Transaction duration monitoring**
Detect long-running or rolled-back transactions. Add a `TransactionMonitor` that hooks `BEGIN`/`COMMIT`/`ROLLBACK` on the same channels the driver patches already use. Emit `slow-transaction` when a transaction exceeds a configurable threshold (default: 5 s).

**GC pressure monitoring**
Use `node:v8` `PerformanceObserver` on `gc` entries to track pause times and frequency. Surface `gc-pressure` events when total GC time in a window exceeds a configurable percentage of wall time (default: 10%). No native modules required — pure JS.

**Cache hit-rate monitoring**
For Redis and Memcached drivers, track `GET` commands that return `null` vs. non-null. Emit a rolling `cache-miss-rate` metric. Integrate with `SlowQueryMonitor`'s per-driver threshold model so a miss-rate spike triggers a `slow-query`-style event.

---

### Medium-term (moderate effort)

**Query plan analysis (EXPLAIN integration)**
Automatically `EXPLAIN` queries that exceed the slow-query threshold on PostgreSQL and MySQL. Parse the plan to detect full table scans, missing indexes, and nested-loop explosions. Attach a `queryPlan` field to `SlowQueryRecord` and emit it in the `slow-query` event. Gate behind an opt-in flag (`withSlowQueryMonitor({ explainThresholdMs: 2000 })`) because EXPLAIN adds a round-trip.

**Distributed tracing (W3C TraceContext)**
Propagate `traceparent` / `tracestate` headers on outgoing HTTP requests and read them on incoming ones. Store the active span in `AsyncLocalStorage` so every `TracedQuery`, `SlowQueryRecord`, and `ProfilerEvent` carries a `traceId`. Export spans as OTLP traces alongside the existing OTLP metrics. This composes with the existing `correlationId` field — `traceId` replaces it end-to-end.

**DNS resolution monitoring**
Wrap `dns.resolve*` and `dns.lookup` to track lookup times. Emit `slow-dns` events when lookups exceed a threshold (default: 200 ms). Detect repeated failures and emit a `dns-error-rate` metric. Most latency investigations eventually reveal a DNS issue — having this in the same telemetry stream saves a lot of manual cross-referencing.

**Heap snapshot on OOM-approach**
When `heapUsed / heapTotal` exceeds 90% for two consecutive ticks, write a V8 heap snapshot to a temp file via `v8.writeHeapSnapshot()` and emit a `heap-snapshot` event with the path. Guard behind a cooldown (1 snapshot per 10 min) to avoid cascading I/O. Pairs with `SourceMapResolver` so the snapshot can be symbolicated.

---

### Longer-term (architectural changes)

**OpenTelemetry SDK bridge**
Export all events as proper OTel spans, metrics, and logs rather than the current custom OTLP JSON format. This lets users plug any OTel-compatible backend (Jaeger, Tempo, Honeycomb, Datadog) without a custom collector. The internal event model stays the same; only the `OTLPExporter` layer changes.

**Adaptive sampling**
When query volume is high, automatically downsample routine queries and always capture slow/failed ones at 100%. Store the sampling decision in `TracedQuery.sampleRate` so downstream systems can correct for it. Use a token-bucket per driver so bursts don't flood the exporter.

**Browser / edge runtime support**
The current architecture assumes Node.js APIs (`diagnostics_channel`, `process`, `node:v8`). A thin adapter layer could replace these with browser-compatible primitives (`PerformanceObserver`, `fetch` hooks) and ship a `@argus/browser` package that reuses the sanitization, analysis, and export layers unchanged.
