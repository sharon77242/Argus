# Argus

> **Privacy-first performance diagnostics for Node.js — minimum Node 14.18 as a compiled package, Node 22.6 for source/dev mode**

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/sharon77242)

![Argus demo](docs/demo.gif)

A lightweight agent that embeds directly into your application — silently tracking runtime behaviour, isolating bottlenecks, and mathematically sanitizing all context before exporting OpenTelemetry (OTLP) telemetry to your observability stack.

---

## Table of Contents

1. [Why This Exists](#why-this-exists)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Quick Start](#quick-start)
5. [Demo App](#demo-app)
6. [Profile API (recommended)](#profile-api-recommended)
   - [Environment Presets](#environment-presets)
   - [App Type Presets](#app-type-presets)
   - [Auto-Detection](#auto-detection)
7. [Builder API (fine-grained)](#builder-api-fine-grained)
   - [Slow Query Monitor](#slow-query-monitor)
   - [Transaction Monitor](#transaction-monitor)
   - [Cache Monitor](#cache-monitor)
   - [GC Monitor](#gc-monitor)
   - [Pool Monitor](#pool-monitor)
   - [DNS Monitor](#dns-monitor)
   - [Adaptive Sampler](#adaptive-sampler)
8. [Instance Methods](#instance-methods)
9. [Events Reference](#events-reference)
10. [Environment Variables](#environment-variables)
11. [Production Safety Reference](#production-safety-reference)
12. [Privacy Guarantees](#privacy-guarantees)
13. [Architecture Layers](#architecture-layers)
14. [Project Structure](#project-structure)
15. [Low-Level API](#low-level-api)
16. [Self-Host Your OTLP Endpoint](#self-host-your-otlp-endpoint)
17. [SaaS Dashboard — Coming Soon](#saas-dashboard--coming-soon)
18. [License](#license)

---

## Why This Exists

Standard APM products either require heavy agents, compile steps, or sacrifice data privacy by shipping raw query values and log payloads to the cloud. This agent takes a different position:

- **100% in-process** — no sidecar, no daemon, no separate process
- **AST-first privacy** — SQL/NoSQL query values are shredded at the AST layer before they ever touch a metric
- **Entropy-checked logs** — Shannon entropy scanning strips JWT tokens, API keys, and any other high-entropy string from `console` payloads automatically
- **Zero prototype pollution** — all DB interception goes through `node:diagnostics_channel`, the official Node.js observability primitive

---

## Requirements

The agent has two distinct usage modes with different Node.js requirements:

| Usage Mode | Min Node.js | When to use |
|---|---|---|
| **Compiled npm package** _(recommended for most users)_ | **≥ 14.18.0** | You install the built package in your project via npm |
| **Source / dev mode** _(this repo, contributors)_ | **≥ 22.6.0** | You run `.ts` files directly with `--experimental-strip-types` |

> [!IMPORTANT]
> **Most users should use the compiled package** and only need Node ≥ 14.18.0.
> The 22.6.0 requirement only applies to running the TypeScript source files directly (e.g. contributors, or the `npm test` / `npm start` scripts in this repo).

### Why 14.18.0 as the compiled minimum?

`node:diagnostics_channel` has been present since **Node 14.0.0** (experimental) and became stable in Node 18.7.0. The API surface the agent uses (`.channel()`, `.subscribe()`, `.publish()`, `.unsubscribe()`) has not changed between the two versions, so the compiled package works on any Node ≥ 14.18.0 with two caveats:

| Feature | Minimum Node | Behaviour on older versions |
|---|---|---|
| DB query tracing (all 16 drivers) | 14.18.0 | Full support — we control both publisher and subscriber |
| HTTP outbound tracing | 18.0.0 | Automatic via `diagnostics_channel`; on Node 14–17 the agent falls back to monkey-patching `http.request` / `https.request` automatically |
| Module load timing (`slow-require`) | 20.0.0 | Silent no-op on Node < 20 (channels absent) |
| Stream leak auto-detection | 22.0.0 | Falls back to manual `track()` calls on Node < 22 |
| Worker-threads pool monitoring | 22.0.0 | No auto-detection on Node < 22 |

Everything else (`node:perf_hooks`, `node:v8`, `node:inspector`, `node:fs/promises`) has been available since Node 12+. Once this package is compiled to JavaScript, `--experimental-strip-types` is irrelevant — the consumer runs plain `.js`.

### ESM & CJS — both supported

This package ships a **dual build**: ESM and CommonJS. Node.js picks the right format automatically via the `exports` field — no config needed on your side.

```js
// ✅ ESM project (type:module or .mjs)
import { ArgusAgent } from 'argus';

// ✅ CommonJS project — require() works directly
const { ArgusAgent } = require('argus');

// ✅ CommonJS project — dynamic import also works
const { ArgusAgent } = await import('argus');
```

---

## Installation

### Using the compiled package in your project (Node ≥ 14.18)

```bash
npm install argus
```

Then import from the compiled entry point:

```typescript
import { ArgusAgent } from 'argus';
```

### Building from source (Node ≥ 22.6, contributors only)

```bash
git clone https://github.com/sharon77242/Argus.git
npm install

# Run all 373 tests (uses --experimental-strip-types, requires Node 22.6+)
npm test

# Build both ESM and CJS outputs
npm run build
#   └─ build:esm  → tsc -p tsconfig.build.json  → dist/esm/**/*.js  + .d.ts
#   └─ build:cjs  → tsc -p tsconfig.cjs.json    → dist/cjs/**/*.cjs + .d.cts
#                   (post-build script renames .js → .cjs, .d.ts → .d.cts)

# Build only one format if needed
npm run build:esm
npm run build:cjs
```

The published `dist/` directory contains:

```
dist/
  esm/          ← consumed by import / ESM bundlers
    index.js
    index.d.ts
    ...
  cjs/          ← consumed by require() / CommonJS bundlers
    index.cjs
    index.d.cts
    ...
```

---

## Quick Start

```typescript
// Compiled npm package
import { ArgusAgent } from 'argus';

// Or if running source directly (Node 22.6+)
// import { ArgusAgent } from './packages/agent/src/index.ts';

const agent = await ArgusAgent.createProfile({
  environment: 'prod',   // or 'dev' | 'test'
  appType: ['web', 'db'],
}).start();
// SIGTERM / SIGINT → flush telemetry → process.exit is wired automatically
```

> [!NOTE]
> **Zero-overhead kill-switch** — set `DIAGNOSTIC_AGENT_ENABLED=false` (or `0`) in any environment and the agent skips all initialisation with no CPU cost. Useful for gradual rollouts, incident response, or staging overrides without a code deploy.

---

## Demo App

`quotes-demo-app/` is a small Express + PostgreSQL API that runs the agent in dev mode and streams every monitoring event to the terminal in colour. Use it to see the agent in action before wiring it into your own project.

```bash
# Quickest path — fully containerised, no local Node.js required
docker compose -f docker-compose.demo.yml up --build
```

Or run Node.js natively against a Dockerised Postgres:

```bash
cd packages/agent && pnpm build && cd ../..
cd quotes-demo-app && docker compose -f docker-compose-pg-only.yml up -d && npm install
node simulate.js   # scripted traffic sequence — watch the agent fire in real time
```

See [`quotes-demo-app/README.md`](quotes-demo-app/README.md) for the full setup guide, annotated terminal output, and curl examples.

---

## Profile API (recommended)

`createProfile` returns a pre-configured builder instance wired for your environment and app type. Call `.start()` to initialize all subsystems.

```typescript
const agent = await ArgusAgent.createProfile({
  environment: 'prod',        // 'dev' | 'test' | 'prod'
  appType: ['web', 'db'],     // single string or array — modules are unioned
  enabled: true,              // overridden by DIAGNOSTIC_AGENT_ENABLED env-var
  workspaceDir: process.cwd(), // dev/test only — enables StaticScanner, AuditScanner, SourceMaps
}).start();
```

### Environment Presets

| `environment` | Modules Enabled | Optimization Target |
|---|---|---|
| `prod` | CrashGuard, LogTracing, GracefulShutdown | **Stability** — minimal overhead, high safety |
| `dev` | `prod` + FsTracing + StaticScanner, AuditScanner, SourceMaps _(when `workspaceDir` set)_ | **Forensics** — deep blocking & security analysis |
| `test` | `prod` + FsTracing + StaticScanner, AuditScanner, SourceMaps _(when `workspaceDir` set)_ | **Forensics** — same as `dev` |

### App Type Presets

| `appType` | Modules Enabled | Optimization Target |
|---|---|---|
| `'web'` | HttpTracing, ResourceLeakMonitor, Auto-Patching | **Latency** — request/response & socket tracking |
| `'db'` | QueryAnalysis, SlowQueryMonitor, ResourceLeakMonitor, Auto-Patching | **Data Access** — query patterns & connection safety |
| `'worker'` | RuntimeMonitor (CPU/Mem), GcMonitor, ResourceLeakMonitor, Auto-Patching | **Throughput** — long-running safety & loop health |
| `['web','db']` | Union of `web` + `db` | **Hybrid** — full HTTP + query coverage |
| `['web','db','worker']` | All modules | **Full-Stack** — maximum observability |

Each `.with*()` call is **idempotent** — combining types never double-registers a module.

#### Multi-role examples

```typescript
// Express API + background job runner
ArgusAgent.createProfile({ appType: ['web', 'worker'] });

// Worker that queries databases directly
ArgusAgent.createProfile({ appType: ['db', 'worker'] });

// Monolith — full coverage
ArgusAgent.createProfile({ appType: ['web', 'db', 'worker'] });
```

### Auto-Detection

Leave `appType` unset (or set it to `'auto'`) and the agent will scan your `package.json` dependencies to infer the correct profile:

```typescript
const agent = await ArgusAgent.createProfile({
  environment: 'prod',
  // appType: 'auto' is the default
}).start();

// agent.on('info', msg => console.log(msg))  ← fires in dev/test if nothing is detected
```

You can also call the detector standalone:

```typescript
const result = ArgusAgent.detectAppTypes('./my-service');
// { types: ['web', 'db'], matches: { web: ['express', 'cors'], db: ['pg', 'ioredis'], worker: [] } }
```

**Recognized fingerprints (non-exhaustive):**

| Type | Packages |
|---|---|
| `web` | express, fastify, koa, @hapi/hapi, @nestjs/core, next, nuxt, socket.io, ws, apollo-server, … |
| `db` | pg, mysql2, mongodb, mongoose, sequelize, typeorm, @prisma/client, knex, redis, ioredis, mssql, … |
| `worker` | bull, bullmq, agenda, bee-queue, pg-boss, node-cron, amqplib, kafkajs, piscina, … |

> [!NOTE]
> If no packages match and `environment` is `dev` or `test`, the agent emits an `'info'` event advising you to set `appType` explicitly. In `prod`, it starts silently with only the environment-level modules (CrashGuard, LogTracing, GracefulShutdown).

---

## Builder API (fine-grained)

For maximum control, compose the agent manually using the fluent builder:

```typescript
import { ArgusAgent } from 'argus';
import fs from 'node:fs';

const agent = await ArgusAgent.create()
  .withSourceMaps('./dist')                          // Source-map resolution for stack traces
  .withRuntimeMonitor({ eventLoopThresholdMs: 50 }) // Event loop lag + memory leak detection
  .withInstrumentation({ autoPatching: true })       // 16 DB drivers via diagnostics_channel
  .withHttpTracing()                                 // Slow request & insecure HTTP detection
  .withLogTracing({ scrubContext: true })            // Strip secrets from console overrides
  .withFsTracing()                                   // ⚠ DEV ONLY — sync FS blocker detection
  .withCrashGuard()                                  // uncaughtException telemetry flush
  .withResourceLeakMonitor({
    handleThreshold: 5000,
    alertCooldownMs: 60_000,                         // Min ms between repeated leak alerts
  })
  .withGracefulShutdown({ timeoutMs: 5000 })         // SIGTERM/SIGINT → flush → process.exit
  .withQueryAnalysis()                               // AST-based N+1 & query fix suggestions
  .withSlowQueryMonitor({ defaultThresholdMs: 500 }) // Per-driver slow query log (top-5)
  .withTransactionMonitor()                          // BEGIN/COMMIT/ROLLBACK duration tracking
  .withCacheMonitor({ minHitRate: 0.6 })            // Cache hit-rate degradation detection
  .withGcMonitor({ pausePctThreshold: 15 })         // GC pressure detection
  .withPoolMonitor()                                 // Connection pool exhaustion & slow-acquire
  .withDnsMonitor({ slowThresholdMs: 200 })         // DNS resolution latency tracking
  .withAdaptiveSampler({ burst: 20 })               // Token-bucket rate limiter under high load
  .withStaticScanner(process.cwd())                 // ⚠ DEV ONLY — background tsc/eslint
  .withAuditScanner(process.cwd())                  // ⚠ DEV ONLY — npm audit CVE scan
  .withExporter({
    endpointUrl: 'https://otel.example.com/v1/traces',
    key:  fs.readFileSync('./certs/client.key'),
    cert: fs.readFileSync('./certs/client.crt'),
    ca:   fs.readFileSync('./certs/ca.crt'),
  })
  .start();

// Register pools after start (requires .withPoolMonitor())
agent.watchPool(pgPool, 'pg');
agent.watchPool(mysql2Pool, 'mysql2');
```

Every `.with*()` method is **optional** — enable only what you need. All internal event wiring, entropy scrubbing, and p99 aggregation happens automatically.

### Slow Query Monitor

```typescript
.withSlowQueryMonitor({
  defaultThresholdMs: 1000,           // global fallback threshold (default: 1000)
  thresholds: { pg: 500, redis: 50 }, // per-driver overrides (also configurable via env vars)
  topN: 5,                            // top-N slowest queries retained in memory (default: 5)
})
```

Fires `'slow-query'` when a query exceeds the threshold for its driver. Access the log via `agent.getSlowQueries()` / `agent.getSlowestQuery()` / `agent.clearSlowQueries()`.

### Transaction Monitor

```typescript
.withTransactionMonitor({
  maxOpenMs: 60_000,  // evict open transactions after this duration (default: 60 000)
})
```

Detects BEGIN/COMMIT/ROLLBACK patterns in traced queries. Fires `'transaction'` with duration, query count, and whether the transaction was aborted.

### Cache Monitor

```typescript
.withCacheMonitor({
  windowMs: 60_000,   // sliding window size (default: 60 000)
  minSamples: 10,     // minimum samples before an event can fire (default: 10)
  minHitRate: 0.5,    // fire when hit rate drops below this value 0–1 (default: 0.5)
})
```

Monitors cache hit/miss ratios for traced drivers (Redis, Memcached). Fires `'cache-degraded'` when the hit rate falls below `minHitRate` within the window.

### GC Monitor

```typescript
.withGcMonitor({
  windowMs: 10_000,       // sliding window for pressure calculation (default: 10 000)
  pausePctThreshold: 10,  // fire when GC consumes ≥ this % of the window (default: 10)
})
```

Observes GC performance entries via `node:perf_hooks`. Fires `'gc-pressure'` with total pause time, pause percentage, and GC cycle count.

### Pool Monitor

```typescript
.withPoolMonitor({
  maxWaitingCount: 3,     // fire 'pool-exhaustion' when this many clients wait (default: 3)
  maxWaitMs: 1000,        // fire 'slow-acquire' when acquiring takes longer (default: 1000)
  checkIntervalMs: 5000,  // poll interval for pool statistics (default: 5000)
})
```

After calling `.withPoolMonitor()`, register each pool instance:

```typescript
agent.watchPool(pgPool, 'pg');
agent.watchPool(mysql2Pool, 'mysql2');
```

Compatible with any pool that exposes `totalCount` / `idleCount` / `waitingCount` getters and/or emits an `'acquire'` event (`pg.Pool`, `mysql2` pool, `generic-pool`).

### DNS Monitor

```typescript
.withDnsMonitor({
  slowThresholdMs: 100,  // fire 'slow-dns' above this duration (default: 100)
})
```

Wraps `dns.lookup` to track every resolution. Fires `'dns'` for each lookup and `'slow-dns'` for those exceeding the threshold.

### Adaptive Sampler

```typescript
.withAdaptiveSampler({
  ratePerMs: 1 / 1000,  // token refill rate — 1 token/sec by default
  burst: 10,            // max bucket depth / burst capacity (default: 10)
})
```

Token-bucket rate limiter applied per event category (`'query'`, `'http'`). Under sustained high throughput, events beyond the bucket capacity are silently dropped, capping agent overhead without disabling monitoring.

### Manually tracing unsupported drivers

For drivers that don't publish to `diagnostics_channel`, use `traceQuery`:

```typescript
const rows = await agent.traceQuery(
  'SELECT * FROM orders WHERE id = $1',
  () => db.query('SELECT * FROM orders WHERE id = $1', [42])
);
```

---

## Instance Methods

After calling `.start()`, the agent exposes several utility methods:

### Slow query log

```typescript
agent.getSlowQueries(): SlowQueryRecord[]   // top-N slowest queries, sorted slowest first
agent.getSlowestQuery(): SlowQueryRecord | undefined
agent.clearSlowQueries(): void              // reset the log (useful between test cases)
```

Requires `.withSlowQueryMonitor()`. Returns an empty array / `undefined` if not enabled.

### Pool registration

```typescript
agent.watchPool(pool: PoolLike, driver: string): this
```

Register a connection pool for monitoring. Safe to call before or after `.start()`. Requires `.withPoolMonitor()`.

### Request tracing middleware

```typescript
app.use(agent.createMiddleware());
```

Connect-compatible middleware that reads the incoming `traceparent` W3C header and runs the request inside a `RequestContext`. All queries and HTTP calls within the same async chain automatically carry the same `traceId` and `correlationId`. Compatible with Express, Fastify (express-compat), Koa-connect, and raw Node HTTP.

### Manual context (background jobs / queue workers)

```typescript
import { runWithContext } from 'argus';

const ctx = agent.createContext('JOB', '/process-order');
runWithContext(ctx, async () => {
  // all traced queries here carry ctx.traceId
  await processOrder(orderId);
});
```

### Source map resolution

```typescript
const original = await agent.resolvePosition('./dist/index.js', 42, 15);
// { source: 'src/handlers/order.ts', line: 10, column: 3 }
```

Requires `.withSourceMaps()`.

---

## Events Reference

The agent is an `EventEmitter`. All events are emitted on the `ArgusAgent` instance:

| Event | Payload | When |
|---|---|---|
| `'anomaly'` | `ProfilerEvent` | Memory leak, event loop lag, CPU spike detected |
| `'query'` | `{ sanitizedQuery, durationMs, driver?, traceId?, correlationId?, cacheHit?, suggestions? }` | DB query completed |
| `'slow-query'` | `SlowQueryRecord` | Query exceeded the per-driver threshold |
| `'transaction'` | `TransactionEvent` | BEGIN/COMMIT/ROLLBACK pattern completed |
| `'cache-degraded'` | `CacheDegradedEvent` | Cache hit rate dropped below `minHitRate` |
| `'gc-pressure'` | `GcPressureEvent` | GC pause % exceeded threshold in the window |
| `'pool-exhaustion'` | `PoolExhaustionEvent` | Waiting client count exceeded `maxWaitingCount` |
| `'slow-acquire'` | `SlowAcquireEvent` | Connection acquire time exceeded `maxWaitMs` |
| `'http'` | `{ method, url, statusCode, durationMs, suggestions }` | HTTP request completed |
| `'dns'` | `DnsEvent` | DNS lookup completed |
| `'slow-dns'` | `DnsEvent` | DNS lookup exceeded `slowThresholdMs` |
| `'fs'` | `{ operation, path, durationMs, suggestions }` | File system operation completed |
| `'log'` | `{ level, scrubbed, durationMs, suggestions? }` | `console.*` call intercepted |
| `'crash'` | `CrashEvent` | `uncaughtException` or `unhandledRejection` received |
| `'leak'` | `ResourceLeakEvent` | Active OS handle count exceeded threshold |
| `'scan'` | `StaticScanResult[]` | Background `tsc`/ESLint scan complete (dev/test only) |
| `'audit'` | `AuditResult` | `npm audit` CVE scan complete (dev/test only) |
| `'info'` | `string` | Advisory messages (e.g., auto-detection found nothing) |
| `'error'` | `Error` | Non-fatal internal error (e.g., heap snapshot write failed) |

```typescript
agent.on('anomaly', (event) => {
  console.log(event.type);             // 'memory-leak' | 'event-loop-lag' | 'cpu-spike'
  console.log(event.heapSnapshotPath); // only set when a snapshot write succeeded
});

agent.on('crash', (event) => {
  console.log(event.type); // 'uncaughtException' | 'unhandledRejection'
  // NOTE: unhandledRejection does NOT call process.exit — your app keeps running
});

agent.on('query', (trace) => {
  console.log(trace.sanitizedQuery); // bound values are NEVER here — AST-scrubbed
  trace.suggestions?.forEach(s => console.log(s.rule, s.suggestedFix)); // present only with withQueryAnalysis()
});

agent.on('slow-query', (record) => {
  console.log(record.sanitizedQuery, record.durationMs, record.driver);
  // agent.getSlowQueries() returns the persisted top-N log at any time
});

agent.on('transaction', (event) => {
  if (event.aborted) console.warn(`Rolled-back txn on ${event.driver} after ${event.durationMs}ms`);
});

agent.on('gc-pressure', (event) => {
  console.warn(`GC consuming ${event.pausePct.toFixed(1)}% of CPU time`);
});

agent.on('pool-exhaustion', (event) => {
  console.warn(`${event.driver} pool: ${event.waitingCount} clients queued`);
});
```

> [!NOTE]
> `ArgusAgent` calls `setMaxListeners(0)` internally — you can attach as many listeners as needed without triggering Node's memory leak warning.

---

## Environment Variables

All thresholds can be overridden without code changes, making the agent CI/CD and container-friendly:

| Variable | Default | Controls |
|---|---|---|
| `DIAGNOSTIC_AGENT_ENABLED` | `true` | Set to `false` or `0` for a zero-CPU-overhead global kill-switch |
| `DIAGNOSTIC_DEBUG` | `false` | Set to `true` to enable the built-in console logger for all agent events |
| `RUNTIME_MONITOR_EVENT_LOOP_THRESHOLD_MS` | `50` | Minimum lag (ms) before an event-loop anomaly fires |
| `RUNTIME_MONITOR_MEMORY_GROWTH_BYTES` | `10485760` (10 MB) | Minimum heap growth before a memory-leak anomaly fires |
| `RUNTIME_MONITOR_CPU_PROFILE_COOLDOWN_MS` | `60000` | Minimum ms between back-to-back CPU profiles |
| `RUNTIME_MONITOR_CHECK_INTERVAL_MS` | `1000` | How often thresholds are polled |
| `RUNTIME_MONITOR_CPU_PROFILE_DURATION_MS` | `500` | Duration of each CPU profile capture |
| `RUNTIME_MONITOR_HEAP_USAGE_PCT_THRESHOLD` | `90` | Heap usage % of `heapTotal` before a memory anomaly fires |
| `ARGUS_SLOW_QUERY_THRESHOLD_MS` | `1000` | Global slow query threshold used when no per-driver default applies |
| `ARGUS_SLOW_QUERY_THRESHOLD_<DRIVER>` | (per-driver) | Per-driver threshold override. Key is the driver name uppercased with non-alphanumeric runs replaced by `_` — e.g. `ARGUS_SLOW_QUERY_THRESHOLD_PG=500`, `ARGUS_SLOW_QUERY_THRESHOLD_REDIS=50`, `ARGUS_SLOW_QUERY_THRESHOLD_ELASTIC_ELASTICSEARCH=300` |

> [!TIP]
> Malformed values (non-numeric, `0`, negative) are silently ignored and replaced with the default. This means misconfigured infrastructure cannot accidentally disable monitoring.

---

## Production Safety Reference

| Method | Prod Safe? | Resource Impact | Description |
|---|---|---|---|
| `ArgusAgent.createProfile(config)` | ✅ Yes | N/A | Pre-configured instance from env/app presets |
| `ArgusAgent.create()` | ✅ Yes | N/A | Unconfigured fluent builder |
| `.withSourceMaps(dir?)` | ✅ Yes | Very Low | Source-map resolution for minified stack traces |
| `.withRuntimeMonitor(opts?)` | ✅ Yes | Low | Event loop lag + memory leak detection |
| `.withCrashGuard()` | ✅ Yes | Very Low | Intercepts `uncaughtException`; emits event for `unhandledRejection` |
| `.withResourceLeakMonitor(opts?)` | ✅ Yes | Low | Tracks OS handles; rate-limited by `alertCooldownMs` |
| `.withGracefulShutdown(opts?)` | ✅ Yes | Very Low | Registers SIGTERM/SIGINT; awaits `agent.stop()` before `process.exit` |
| `.withInstrumentation(opts?)` | ✅ Yes | Low | DB/IO tracing via `diagnostics_channel` (16 drivers) |
| `.withHttpTracing()` | ✅ Yes | Low | HTTP request inspection & slow-request detection |
| `.withLogTracing(opts?)` | ✅ Yes | Low | `console.*` override with entropy-scrubbed payloads |
| `.withFsTracing()` | ❌ **No** | High | Patches `fs`. Detects `*Sync` blockers. **DEV ONLY.** |
| `.withQueryAnalysis()` | ✅ Yes | Medium (AST) | N+1 detection + query fix suggestions |
| `.withSlowQueryMonitor(opts?)` | ✅ Yes | Very Low | Per-driver slow query detection + top-N log |
| `.withTransactionMonitor(opts?)` | ✅ Yes | Very Low | BEGIN/COMMIT/ROLLBACK duration tracking |
| `.withCacheMonitor(opts?)` | ✅ Yes | Very Low | Cache hit-rate degradation detection |
| `.withGcMonitor(opts?)` | ✅ Yes | Very Low | GC pause pressure detection via `perf_hooks` |
| `.withPoolMonitor(opts?)` | ✅ Yes | Low | Connection pool exhaustion & slow-acquire |
| `.withDnsMonitor(opts?)` | ✅ Yes | Low | DNS lookup latency tracking |
| `.withAdaptiveSampler(opts?)` | ✅ Yes | Very Low | Token-bucket rate limiter under high load |
| `.withStaticScanner(dir)` | ❌ **No** | High | Background `tsc`/ESLint scan. **DEV ONLY.** |
| `.withAuditScanner(dir)` | ❌ **No** | High | Spawns `npm audit`. **DEV/startup ONLY.** |
| `.withExporter(config)` | ✅ Yes | Very Low | OTLP JSON export over mTLS |
| `.withAggregatorWindow(ms)` | ✅ Yes | None | Override p99 sliding window (default: 60 s) |
| `.withEntropyThreshold(n)` | ✅ Yes | None | Override Shannon entropy threshold (default: 4.0) |
| `.start()` | — | — | Async — initialize all subsystems and begin monitoring |
| `.stop()` | — | — | Async — tear down and flush remaining telemetry |

---

## Privacy Guarantees

### What this agent collects

- Query **structure** (SQL/NoSQL operation type, tables, columns, clauses)
- HTTP method, URL path (no query-string), status code, duration
- Event loop lag duration (ms)
- Heap growth (bytes)
- File path + operation type (no file contents)
- Log level + message (after entropy scrubbing)

### What this agent never collects

| Data Class | Mechanism |
|---|---|
| SQL / NoSQL bound values | AST-level replacement — values are replaced before the string is ever stored |
| High-entropy strings (JWTs, API keys, tokens) | Shannon entropy check (default threshold: 4.0 bits/char) |
| PII in log messages | Entropy scrubbing on all `console.*` payloads |
| Raw file contents | Only `path` and `operation` are recorded |
| Heap object values | Only growth delta in bytes is recorded |

### Transport security

Telemetry is exported over **mTLS** (Mutual TLS) — both client and server certificates are verified. No telemetry is sent without explicit `.withExporter(config)` configuration.

---

## Architecture Layers

```
┌──────────────────────────────────────────────────────────────────┐
│                        ArgusAgent                            │  ← Fluent builder / event bus
├──────────────────┬─────────────────────────┬─────────────────────┤
│ Profiling        │  Instrumentation         │  Analysis           │
│ ──────────────── │  ─────────────────────  │  ─────────────────  │
│ RuntimeMonitor   │  InstrumentationEngine  │  QueryAnalyzer      │
│ CrashGuard       │  16 DB Drivers          │  SlowQueryMonitor   │
│ ResourceLeakMon  │  HttpInstrumentation    │  TransactionMonitor │
│ GcMonitor        │  FsInstrumentation      │  CacheMonitor       │
│ PoolMonitor      │  LoggerInstrumentation  │  CircuitBreaker     │
│ SourceMapResolver│  DnsMonitor             │  StaticScanner      │
│ WorkerThreadsMon │  AdaptiveSampler        │  AuditScanner       │
│ SlowRequireDet.  │                         │  ExplainAnalyzer    │
│ StreamLeakDet.   │                         │                     │
├──────────────────┴─────────────────────────┴─────────────────────┤
│               AstSanitizer + EntropyChecker                       │  ← Privacy firewall (always on)
├──────────────────────────────────────────────────────────────────┤
│             MetricsAggregator (p99 sliding window)                │
├──────────────────────────────────────────────────────────────────┤
│         OTLPExporter (mTLS)  /  OTLPCompatibleExporter (API key) │
└──────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
packages/agent/
  src/
    index.ts                         → Public API barrel export
    diagnostic-agent.ts              → Fluent builder, public API surface & lifecycle

    internal/
      profile-factory.ts             → buildAgentProfile() — preset resolution for createProfile()
      query-handler.ts               → createQueryHandler() — per-query sampling/analysis/slow-log closure
      console-logger.ts              → installConsoleLogger() — DIAGNOSTIC_DEBUG event formatting

    profiling/
      app-type-detector.ts           → package.json fingerprint scanner
      runtime-monitor.ts             → Event loop lag & heap snapshot profiling
      crash-guard.ts                 → uncaughtException / unhandledRejection handler
      graceful-shutdown.ts           → SIGTERM/SIGINT flush with configurable timeout
      resource-leak-monitor.ts       → OS handle / socket leak detection
      slow-require-detector.ts       → CJS module load-time tracking (Node 20+)
      stream-leak-detector.ts        → Readable/Writable stream leak detection
      worker-threads-monitor.ts      → Worker pool depth & anomaly tracking (Node 22+)
      source-map-resolver.ts         → .js.map scanning & lazy resolution
      gc-monitor.ts                  → GC pressure detection via perf_hooks
      pool-monitor.ts                → Connection pool exhaustion & slow-acquire

    instrumentation/
      safe-channel.ts                → Backward-compatible diagnostics_channel loader (Node 14.18+)
      engine.ts                      → Core InstrumentationEngine
      correlation.ts                 → AsyncLocalStorage request context & correlationId
      http.ts                        → HTTP tracing (channel path Node 18+; monkey-patch Node 14–17)
      fs.ts                          → File system operation tracing
      logger.ts                      → console.* override with entropy scrubbing
      dns-monitor.ts                 → DNS lookup latency tracking
      adaptive-sampler.ts            → Token-bucket adaptive sampler
      drivers/
        index.ts                     → Driver registry (apply / remove patches)
        patch-utils.ts               → Shared wrapping utilities & PATCHED_SYMBOL
        pg.ts                        → PostgreSQL
        mysql.ts                     → MySQL / Aurora (mysql2)
        mongodb.ts                   → MongoDB
        mssql.ts                     → MSSQL / tedious
        sqlite.ts                    → better-sqlite3
        prisma.ts                    → @prisma/client
        redis.ts                     → ioredis + node-redis
        dynamodb.ts                  → @aws-sdk/client-dynamodb
        firestore.ts                 → @google-cloud/firestore
        cassandra.ts                 → cassandra-driver
        elasticsearch.ts             → @elastic/elasticsearch
        bigquery.ts                  → @google-cloud/bigquery
        neo4j.ts                     → neo4j-driver
        clickhouse.ts                → @clickhouse/client

    licensing/
      public-key.ts                  → Bundled ECDSA public keys (keyed by kid)
      license-validator.ts           → JWT ES256 signature + expiry validation
      clock-guard.ts                 → Monotonic clock-rollback detection (enterprise)
      expiry-signal.ts               → Writes expiry notice to cwd / tmpdir / homedir

    sanitization/
      ast-sanitizer.ts               → SQL AST scrubbing (node-sql-parser)
      entropy-checker.ts             → Shannon entropy secret detection

    analysis/
      types.ts                       → Shared FixSuggestion & analysis types
      query-analyzer.ts              → AST-based query fix suggestions + N+1 detection
      slow-query-monitor.ts          → Per-driver slow query detection + top-N log
      transaction-monitor.ts         → BEGIN/COMMIT/ROLLBACK duration tracking
      cache-monitor.ts               → Cache hit-rate degradation detection
      explain-analyzer.ts            → EXPLAIN plan analysis for supported drivers
      fs-analyzer.ts                 → Sync FS blocker & path traversal detection
      http-analyzer.ts               → Insecure URL & slow request detection
      log-analyzer.ts                → Log storm & payload size detection
      circuit-breaker-detector.ts    → Sustained error-rate detection across drivers
      static-scanner.ts              → Background tsc / ESLint issue tracking
      audit-scanner.ts               → npm audit CVE scanning

    export/
      aggregator.ts                  → p99 sliding window metric aggregation
      exporter.ts                    → OTLP JSON formatter + mTLS transport
      otlp-compatible-exporter.ts    → Simplified OTLP exporter (API key, no mTLS)

  tests/                             → Mirrors src/ structure (373 tests, 86 suites)
```

---

## Low-Level API

All subsystems are exported individually for advanced composition:

Every subsystem is individually exported — TypeScript autocomplete surfaces the full list. A few useful standalone examples:

```typescript
// Scrub a string manually
import { EntropyChecker } from 'argus';
const sanitized = new EntropyChecker().scrub('Bearer eyJhbGc...');
// → 'Bearer [REDACTED]'

// Detect connection-pool circuit-break conditions without the full agent
import { CircuitBreakerDetector } from 'argus';
const suggestions = new CircuitBreakerDetector().analyze(recentQueryEvents);

// Ship metrics to Honeycomb / New Relic / Datadog without mTLS
import { OTLPCompatibleExporter } from 'argus';
const exporter = new OTLPCompatibleExporter({
  endpointUrl: 'https://api.honeycomb.io/v1/metrics',
  apiKey: process.env.HONEYCOMB_API_KEY,
  serviceName: 'my-service',
});
await exporter.export(aggregatorEvents);

// Manual async-context propagation (background jobs, queue workers)
import { runWithContext } from 'argus';
runWithContext(agent.createContext('WORKER', '/process-job'), async () => {
  // all traced queries here carry the same traceId
  await processJob();
});
```

> **Source mode (contributors):** replace `'argus'` with `'./packages/agent/src/index.ts'` and run with `node --experimental-strip-types` on Node 22.6+.

---

## Self-Host Your OTLP Endpoint

> [!IMPORTANT]
> **OTLP export requires a paid Self-Hosted Pro or Enterprise license.**
> In free mode the agent emits events locally via `EventEmitter` only — `.withExporter()` has no effect without a valid `DIAGNOSTIC_LICENSE_KEY`.
> To get notified when Self-Hosted Pro licenses go on sale: open [this GitHub issue](https://github.com/sharon77242/Argus/issues) or email [sharon10vp614@gmail.com](mailto:sharon10vp614@gmail.com).

The Self-Hosted Pro tier exports standard OTLP JSON directly to your own collector — no data ever leaves your infrastructure. Any OTLP-compatible collector works. Below is the quickest local setup using Jaeger's all-in-one image.

```bash
# Set your license key (Self-Hosted Pro or Enterprise)
export DIAGNOSTIC_LICENSE_KEY="your-license-key"
```

### Jaeger (quickest local setup)

```yaml
# docker-compose.jaeger.yml — save this alongside your project
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "4318:4318"   # OTLP HTTP receiver
      - "16686:16686" # Jaeger UI
    environment:
      - COLLECTOR_OTLP_ENABLED=true
```

```bash
docker compose -f docker-compose.jaeger.yml up -d
```

Then point the agent at it:

```typescript
const agent = await ArgusAgent.createProfile({ environment: 'dev', appType: ['web', 'db'] })
  .withExporter({ endpointUrl: 'http://localhost:4318/v1/traces' })   // no TLS needed locally
  .start();
```

Open `http://localhost:16686` to browse traces.

### Other compatible destinations

| Destination | OTLP endpoint |
|---|---|
| [Grafana Alloy](https://grafana.com/docs/alloy/) | `http://localhost:4318/v1/traces` (default) |
| [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) | configure `otlp` receiver on port 4318 |
| Datadog, New Relic, Honeycomb | use their OTLP ingest URLs with an API key header |

> [!NOTE]
> The `key`/`cert`/`ca` fields in `withExporter` are optional — omit them for plaintext local endpoints. mTLS is only needed for production remote collectors.
>
> For **cloud SaaS destinations** (Honeycomb, New Relic, Datadog) that authenticate via an API key rather than mTLS, use `OTLPCompatibleExporter` from the [Low-Level API](#low-level-api) instead — no license required.

---

## SaaS Dashboard — Coming Soon

Local suggestions fire today with zero account required.
A hosted dashboard with 30-day query history, AI-powered fix suggestions,
and cross-service correlation is in development.

→ Subscribe via [this GitHub issue](https://github.com/sharon77242/Argus/issues) or email [sharon10vp614@gmail.com](mailto:sharon10vp614@gmail.com) to be notified at launch.

---

## Support

If Argus saves you debugging time, consider [sponsoring the project](https://github.com/sponsors/sharon77242) ❤

---

## License

MIT
