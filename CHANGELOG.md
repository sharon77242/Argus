# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Phase R Wave 1 — Cross-signal diagnostic rules**: Five new rules that correlate events
  from multiple subsystems to produce high-signal compound anomalies that no single monitor
  can produce alone.
  - **`sync-in-hot-path`** (`critical`) — `FsAnalyzer` now accepts an `insideRequest` flag.
    When a `*Sync` FS call fires inside an active request context (`AsyncLocalStorage`), a
    second, more specific suggestion is emitted alongside `synchronous-fs`. Wired automatically
    by `FsInstrumentation` via `getCurrentContext()`.
  - **`missing-connection-pool`** (`warning`) — `StaticScanner.runConnectionPoolScan()` walks
    the TypeScript AST at startup to detect `new Client()`, `new Connection()`,
    `createConnection()`, etc. called inside function bodies instead of at module scope.
    Results are surfaced as `tool: "argus-static"` `ScanResult` entries.
  - **`correlated-slow-endpoint`** (`critical`) — `ArgusAgent` cross-references the active
    N+1 traceId index against incoming HTTP events. When an outbound HTTP call exceeds 1 s
    and the same W3C `traceId` has an active N+1 pattern, a compound `anomaly` is emitted.
  - **`pool-starvation-by-slow-query`** (`critical`) — When a `pool-exhaustion` event fires
    within 10 s of a slow query on the same driver, the slow query is surfaced as the likely
    culprit holding connections.
  - **`n-plus-one-in-transaction`** (`critical`) — When N+1 is detected inside an open
    transaction (matched by `traceId` / `correlationId`), severity is escalated to critical
    because repeated queries inside a transaction also delay COMMIT and hold the connection.

### Fixed
- **`SlowQueryMonitor.check()` type contract** — parameter changed from `driver: string` to
  `driver: string | undefined`. When no driver is known (e.g. manual `traceQuery()` calls or
  raw `diagnostics_channel` publishes without a `driver` field), `check()` now returns `null`
  immediately instead of falling back to the synthetic string `"unknown"`, which previously
  triggered a spurious `ARGUS_MISSING_DRIVER_THRESHOLD` process warning in CI.
- **Test isolation** — the `missing-driver warning` describe block in
  `slow-query-monitor.test.ts` previously monkey-patched `process.emitWarning`, which leaked
  across parallel test files and caused a flaky failure in CI. Replaced with the additive
  `process.on('warning')` / `process.off('warning')` API, which is fully parallel-safe. Tests
  are now `async` and yield one `nextTick` before asserting, matching the asynchronous dispatch
  path of `process.emitWarning`.

### Changed
- **Architecture — God object split**: Extracted three cohesive modules from the 1 109-line
  `diagnostic-agent.ts`:
  - `src/internal/profile-factory.ts` — `buildAgentProfile()` contains all preset-resolution
    and builder-wiring logic for `ArgusAgent.createProfile()`.
  - `src/internal/query-handler.ts` — `createQueryHandler()` factory produces the per-query
    processing closure (adaptive sampling → query analysis → slow-query check → aggregation).
  - `src/internal/console-logger.ts` — `installConsoleLogger()` registers formatted console
    output for all agent events and returns the listener pairs for clean removal on `stop()`.
  - `diagnostic-agent.ts` reduced from 1 109 → ~960 lines; each new module has a single
    responsibility and is independently testable.
- **`SlowQueryMonitor.check()` call site** — the `&& traced.driver` guard added in a previous
  hotfix is removed; the type change makes it redundant and the intent is now expressed in the
  contract rather than the caller.

---

## [0.1.0] — 2026-04-11

### Added

#### Core agent
- `ArgusAgent` fluent builder with two entry points: `create()` (manual) and
  `createProfile()` (preset-based).
- Zero-overhead global kill-switch via `ARGUS_ENABLED=false` — `.start()` becomes
  a no-op with no timer, subscription, or memory overhead.
- `ARGUS_DEBUG=true` built-in console logger for all agent events.

#### Preset system
- Three environment presets: `prod`, `dev`, `test`.
- Three app-type presets: `web`, `db`, `worker` (composable as an array).
- `'auto'` mode — scans `package.json` dependencies and infers the correct preset.
- `ArgusAgent.detectAppTypes()` standalone detector.

#### Instrumentation
- `node:diagnostics_channel`-based query tracing for 14 DB drivers: `pg`, `mysql2`, `mssql`,
  `tedious`, `better-sqlite3`, `redis`, `ioredis`, `mongodb`, `@google-cloud/firestore`,
  `@aws-sdk/client-dynamodb`, `neo4j-driver`, `@elastic/elasticsearch`, `@clickhouse/client`,
  `@google-cloud/bigquery`, `cassandra-driver`, `@prisma/client`.
- Zero prototype-pollution — no monkey-patching of driver prototypes in the default path.
- HTTP outbound tracing (`node:diagnostics_channel` on Node ≥ 18; monkey-patch fallback on
  Node 14–17).
- File-system tracing (`fs.*Sync` blocker detection) — dev/test only.
- Console log tracing with Shannon entropy scrubbing.
- DNS lookup latency tracking.
- W3C `traceparent` propagation via `AsyncLocalStorage` (`createMiddleware()` / `runWithContext()`).

#### Analysis
- `SlowQueryMonitor` — per-driver threshold registry (16 built-in defaults), top-N log,
  `ARGUS_SLOW_QUERY_THRESHOLD_<DRIVER>` env var overrides, once-per-driver dev warning for
  unregistered drivers.
- `QueryAnalyzer` — AST-based N+1 and query fix suggestions.
- `TransactionMonitor` — BEGIN/COMMIT/ROLLBACK duration tracking.
- `CacheMonitor` — sliding-window hit-rate degradation detection.
- `CircuitBreakerDetector` — sustained error-rate detection across drivers.
- `ExplainAnalyzer` — EXPLAIN plan parsing for supported drivers.
- `StaticScanner` — background `tsc` / ESLint scan (dev/test only).
- `AuditScanner` — `npm audit` CVE scan (dev/test only).

#### Profiling
- `RuntimeMonitor` — event loop lag, heap growth, CPU profiling.
- `CrashGuard` — `uncaughtException` / `unhandledRejection` telemetry and flush.
- `ResourceLeakMonitor` — OS handle / socket exhaustion detection.
- `GcMonitor` — GC pause pressure via `node:perf_hooks`.
- `PoolMonitor` — connection pool exhaustion and slow-acquire events.
- `SourceMapResolver` — `.js.map` scanning and lazy position resolution.
- `GracefulShutdown` — SIGTERM/SIGINT handler with configurable flush timeout.
- `AdaptiveSampler` — token-bucket rate limiter per event category.

#### Privacy
- `AstSanitizer` — SQL/NoSQL query values shredded at the AST layer (via `node-sql-parser`).
- `EntropyChecker` — Shannon entropy scanner strips JWTs, API keys, and secrets from logs.
  Configurable threshold (default 4.0 bits/char).

#### Export
- `MetricsAggregator` — p99 sliding-window aggregation.
- `OTLPExporter` — OTLP JSON over mTLS (requires paid license).
- `OTLPCompatibleExporter` — simplified OTLP exporter with API key auth.

#### Licensing
- ECDSA ES256 JWT license validation with offline verification.
- Clock-integrity guard (monotonic rollback detection).
- Expiry signal file written to cwd / tmpdir / homedir on license expiry.

#### Developer experience
- Dual ESM + CommonJS build (`dist/esm/` and `dist/cjs/`).
- Native TypeScript source execution via `--experimental-strip-types` (Node ≥ 22.6, dev only).
- Docker demo app (`quotes-demo-app/`) with `docker compose` one-liner.
- 485 tests across 102 suites mirroring the source tree.

[Unreleased]: https://github.com/sharon77242/Argus/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sharon77242/Argus/releases/tag/v0.1.0
