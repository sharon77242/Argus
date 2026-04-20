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
4. [Demo App](#demo-app)
5. [Quick Start](#quick-start)
6. [Profile API (recommended)](#profile-api-recommended)
   - [Environment Presets](#environment-presets)
   - [App Type Presets](#app-type-presets)
   - [Auto-Detection](#auto-detection)
7. [Builder API (fine-grained)](#builder-api-fine-grained)
8. [Events Reference](#events-reference)
9. [Environment Variables](#environment-variables)
10. [Production Safety Reference](#production-safety-reference)
11. [Privacy Guarantees](#privacy-guarantees)
12. [Architecture Layers](#architecture-layers)
13. [Project Structure](#project-structure)
14. [Low-Level API](#low-level-api)
15. [Self-Host Your OTLP Endpoint](#self-host-your-otlp-endpoint)
16. [SaaS Dashboard — Coming Soon](#saas-dashboard--coming-soon)
17. [License](#license)

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
import { DiagnosticAgent } from 'argus';

// ✅ CommonJS project — require() works directly
const { DiagnosticAgent } = require('argus');

// ✅ CommonJS project — dynamic import also works
const { DiagnosticAgent } = await import('argus');
```

---

## Installation

### Using the compiled package in your project (Node ≥ 14.18)

```bash
npm install argus
```

Then import from the compiled entry point:

```typescript
import { DiagnosticAgent } from 'argus';
```

### Building from source (Node ≥ 22.6, contributors only)

```bash
git clone <repo>
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

## Demo App

`quotes-demo-app/` is a small Express + PostgreSQL API that runs the agent in dev mode and streams every monitoring event to the terminal in colour. Use it to see the agent in action before wiring it into your own project.

> **Pick one workflow — do not run both at the same time.**
> - **Local dev** (`docker-compose-pg-only.yml`) — Postgres in Docker, Node.js running natively on your machine. Best for iterating on the agent source.
> - **Full Docker** (`docker-compose.demo.yml`, repo root) — everything containerised; no local Node.js or pnpm required. Best for a clean one-command demo.

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 14.18.0 (compiled) / ≥ 22.6.0 (source/dev) |
| Docker | any recent version |
| pnpm | ≥ 8 (or npm) |

### Setup (one-time)

```bash
# 1. Build the agent package
cd packages/agent
pnpm build          # or: npm run build
cd ../..

# 2. Start Postgres and seed the database (17 programming quotes)
cd quotes-demo-app
docker compose -f docker-compose-pg-only.yml up -d
cd ..

# 3. Install demo dependencies
cd quotes-demo-app
npm install
```

### Run the simulation

```bash
# From quotes-demo-app/
node simulate.js
```

This starts the server, runs a scripted traffic sequence, then exits. You should see output like:

```
╔══════════════════════════════════════════╗
║  Argus — ACTIVE                          ║
╚══════════════════════════════════════════╝

20:36:19.791 [QUERY] [pg] SELECT id, quote, author FROM quote OFFSET $? LIMIT $? (50.3ms)
               ↳ hints: offset-pagination
20:36:19.794 [QUERY] [pg] SELECT id, quote, author FROM quote OFFSET $? LIMIT $? (126.9ms) ⚠ SLOW
               ↳ hints: offset-pagination
20:36:20.007 [QUERY] [pg] SELECT id, quote, author FROM quote OFFSET $? LIMIT $? (44.8ms)
               ↳ hints: offset-pagination, n-plus-one
20:36:20.501 [QUERY] [pg] INSERT INTO quote(quote, author) VALUES ($?, $?) RETURNING * (67.3ms)
20:36:20.503 [HTTP ] POST http://localhost/quotes → 500 (93.8ms)
DB connect string: [REDACTED_SECRET]
20:36:20.504 [SCRUB] console.log contained a high-entropy secret — redacted
20:36:20.601 [QUERY] [pg] SELECT * FROM quote (31.2ms)
               ↳ hints: no-select-star, missing-limit, full-table-scan
20:36:20.710 [QUERY] [pg] UPDATE quote SET updated_at = ? (8.4ms)
               ↳ hints: missing-where-update
20:36:20.820 [FS   ] readFileSync package.json (0.3ms)
               ↳ hints: [critical] synchronous-fs
20:36:20.923 [FS   ] readFileSync package.json (0.2ms)
               ↳ hints: [critical] synchronous-fs, [warning] missing-fs-cache
20:36:21.010 [LOG  ] console.log → [info] unstructured-log
20:36:21.050 [LOG  ] console.log → [warning] large-log-payload
20:36:21.110 [LOG  ] console.error → [critical] log-error-storm
20:36:21.671 [HTTP ] GET http://httpbin.org/get → 200 (437.6ms)
               ↳ hints: insecure-http
20:36:21.902 [SCAN ] static analysis complete — 0 issue(s) across 1 tool(s)
```

**What each tag demonstrates:**

| Tag | Rule fired | Trigger |
|---|---|---|
| `[QUERY]` | — | Every `pg` call intercepted via `diagnostics_channel`; values sanitised to `?` |
| `↳ offset-pagination` | `QueryAnalyzer` | `OFFSET` pagination degrades at scale |
| `↳ n-plus-one` | `QueryAnalyzer` | Same query ≥ 5× within 1 s |
| `↳ no-select-star` | `QueryAnalyzer` | `SELECT *` fetches all columns |
| `↳ full-table-scan` | `QueryAnalyzer` | `SELECT` without `WHERE` or `LIMIT` |
| `↳ missing-where-update` | `QueryAnalyzer` ⚠ critical | `UPDATE` without `WHERE` touches every row |
| `[FS   ]` | `FsAnalyzer` | `fs.readFileSync` / `readFile` calls intercepted |
| `↳ synchronous-fs` | `FsAnalyzer` ⚠ critical | Sync fs call blocks the event loop |
| `↳ missing-fs-cache` | `FsAnalyzer` | Same file read 5+ times within 1 s |
| `[LOG  ]` | `LogAnalyzer` | `console.log/warn/error` intercepted |
| `↳ unstructured-log` | `LogAnalyzer` | Mixing raw strings and objects in one log call |
| `↳ large-log-payload` | `LogAnalyzer` | Log payload > 5 KB can block the event loop |
| `↳ log-error-storm` | `LogAnalyzer` ⚠ critical | 5+ `console.error` calls within 1 s |
| `[HTTP ]` | `HttpAnalyzer` | Outbound HTTP/HTTPS captured via `diagnostics_channel` |
| `↳ insecure-http` | `HttpAnalyzer` ⚠ critical | Plain `http://` request to a remote host |
| `[SCRUB]` | `EntropyChecker` | High-entropy token in a log call — replaced with `[REDACTED_SECRET]` |
| `[ANOM ]` | `RuntimeMonitor` | Event-loop lag > threshold (busy-spin demo) |
| `[SCAN ]` | `StaticScanner` | TypeScript Compiler API on startup |

### Run as a long-running server

```bash
# From quotes-demo-app/
node ./bin/www
```

Then hit the API manually:

```bash
# List quotes (page 1)
curl http://localhost:3000/quotes

# List page 2
curl http://localhost:3000/quotes?page=2

# Add a quote
curl -X POST http://localhost:3000/quotes \
  -H 'Content-Type: application/json' \
  -d '{"quote":"Make it work, make it right, make it fast.","author":"Kent Beck"}'
```

### Fully containerised (optional)

Run both the API and Postgres inside Docker — no local Node.js or pnpm required:

```bash
# From the repo root
docker compose -f docker-compose.demo.yml up --build
```

Logs from the agent stream to stdout. Press `Ctrl-C` to stop, then:

```bash
docker compose -f docker-compose.demo.yml down -v
```

### Teardown (local dev)

```bash
cd quotes-demo-app
docker compose -f docker-compose-pg-only.yml down
```

---

## Quick Start

```typescript
// Compiled npm package
import { DiagnosticAgent } from 'argus';

// Or if running source directly (Node 22.6+)
// import { DiagnosticAgent } from './src/index.ts';

const agent = await DiagnosticAgent.createProfile({
  environment: 'prod',   // or 'dev' | 'test'
  appType: ['web', 'db'],
}).start();

// Graceful shutdown (flushes remaining telemetry)
process.on('SIGTERM', () => agent.stop());
```

---

## Profile API (recommended)

`createProfile` returns a pre-configured builder instance wired for your environment and app type. Call `.start()` to initialize all subsystems.

```typescript
const agent = await DiagnosticAgent.createProfile({
  environment: 'prod',        // 'dev' | 'test' | 'prod'
  appType: ['web', 'db'],     // single string or array — modules are unioned
  enabled: true,              // overridden by DIAGNOSTIC_AGENT_ENABLED env-var
  workspaceDir: process.cwd(),
}).start();
```

### Environment Presets

| `environment` | Modules Enabled | Optimization Target |
|---|---|---|
| `prod` | CrashGuard, LogTracing | **Stability** — minimal overhead, high safety |
| `dev` | `prod` + FsTracing, StaticScanner, AuditScanner, SourceMaps | **Forensics** — deep blocking & security analysis |
| `test` | `prod` + FsTracing, StaticScanner, AuditScanner, SourceMaps | **Forensics** — same as `dev` |

### App Type Presets

| `appType` | Modules Enabled | Optimization Target |
|---|---|---|
| `'web'` | HttpTracing, Socket Leak Monitor, Auto-Patching | **Latency** — request/response & socket tracking |
| `'db'` | QueryAnalysis, Connection Leak Monitor, Auto-Patching | **Data Access** — query patterns & connection safety |
| `'worker'` | RuntimeMonitor (CPU/Mem), Handle Leak Monitor, Auto-Patching | **Throughput** — long-running safety & loop health |
| `['web','db']` | Union of `web` + `db` | **Hybrid** — full HTTP + query coverage |
| `['web','db','worker']` | All modules | **Full-Stack** — maximum observability |

Each `.with*()` call is **idempotent** — combining types never double-registers a module.

#### Multi-role examples

```typescript
// Express API + background job runner
DiagnosticAgent.createProfile({ appType: ['web', 'worker'] });

// Worker that queries databases directly
DiagnosticAgent.createProfile({ appType: ['db', 'worker'] });

// Monolith — full coverage
DiagnosticAgent.createProfile({ appType: ['web', 'db', 'worker'] });
```

### Auto-Detection

Leave `appType` unset (or set it to `'auto'`) and the agent will scan your `package.json` dependencies to infer the correct profile:

```typescript
const agent = await DiagnosticAgent.createProfile({
  environment: 'prod',
  // appType: 'auto' is the default
}).start();

// agent.on('info', msg => console.log(msg))  ← fires in dev/test if nothing is detected
```

You can also call the detector standalone:

```typescript
const result = DiagnosticAgent.detectAppTypes('./my-service');
// { types: ['web', 'db'], matches: { web: ['express', 'cors'], db: ['pg', 'ioredis'], worker: [] } }
```

**Recognized fingerprints (non-exhaustive):**

| Type | Packages |
|---|---|
| `web` | express, fastify, koa, @hapi/hapi, @nestjs/core, next, nuxt, socket.io, ws, apollo-server, … |
| `db` | pg, mysql2, mongodb, mongoose, sequelize, typeorm, @prisma/client, knex, redis, ioredis, mssql, … |
| `worker` | bull, bullmq, agenda, bee-queue, pg-boss, node-cron, amqplib, kafkajs, piscina, … |

> [!NOTE]
> If no packages match and `environment` is `dev` or `test`, the agent emits an `'info'` event advising you to set `appType` explicitly. In `prod`, it starts silently with only the environment-level modules (CrashGuard, LogTracing).

---

## Builder API (fine-grained)

For maximum control, compose the agent manually using the fluent builder:

```typescript
import { DiagnosticAgent } from 'argus';
import fs from 'node:fs';

const agent = await DiagnosticAgent.create()
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
  .withStaticScanner(process.cwd())                 // ⚠ DEV ONLY — background tsc/eslint
  .withAuditScanner(process.cwd())                  // ⚠ DEV ONLY — npm audit CVE scan
  .withExporter({
    endpointUrl: 'https://otel.example.com/v1/traces',
    key:  fs.readFileSync('./certs/client.key'),
    cert: fs.readFileSync('./certs/client.crt'),
    ca:   fs.readFileSync('./certs/ca.crt'),
  })
  .start();
```

Every `.with*()` method is **optional** — enable only what you need. All internal event wiring, entropy scrubbing, and p99 aggregation happens automatically.

### Manually tracing unsupported drivers

For drivers that don't publish to `diagnostics_channel`, use `traceQuery`:

```typescript
const rows = await agent.traceQuery(
  'SELECT * FROM orders WHERE id = $1',
  () => db.query('SELECT * FROM orders WHERE id = $1', [42])
);
```

---

## Events Reference

The agent is an `EventEmitter`. All events are emitted on the `DiagnosticAgent` instance:

| Event | Payload | When |
|---|---|---|
| `'anomaly'` | `ProfilerEvent` | Memory leak, event loop lag, CPU spike detected |
| `'query'` | `{ sanitizedQuery, driverName, durationMs, suggestions }` | DB query completed |
| `'http'` | `{ method, url, statusCode, durationMs, suggestions }` | HTTP request completed |
| `'fs'` | `{ operation, path, durationMs, suggestions }` | File system operation completed |
| `'log'` | `{ level, sanitizedPayload, suggestions }` | `console.*` call intercepted |
| `'crash'` | `CrashEvent` | `uncaughtException` or `unhandledRejection` received |
| `'leak'` | `ResourceLeakEvent` | Active OS handle count exceeded threshold |
| `'scan'` | `StaticScanResult[]` | Background `tsc`/ESLint scan complete (dev/test only) |
| `'audit'` | `AuditResult` | `npm audit` CVE scan complete (dev/test only) |
| `'info'` | `string` | Advisory messages (e.g., auto-detection found nothing) |
| `'error'` | `Error` | Non-fatal internal error (e.g., heap snapshot write failed) |

```typescript
agent.on('anomaly', (event) => {
  console.log(event.type);            // 'memory-leak' | 'event-loop-lag' | 'cpu-spike'
  console.log(event.heapSnapshotPath); // set only when snapshot write succeeded
});

agent.on('crash', (event) => {
  console.log(event.type);            // 'uncaughtException' | 'unhandledRejection'
  // NOTE: unhandledRejection does NOT call process.exit — your app keeps running
});

agent.on('query', (trace) => {
  console.log(trace.sanitizedQuery);  // values NEVER appear here — AST-scrubbed
  trace.suggestions.forEach(s => console.log(s.rule, s.suggestedFix));
});

agent.on('scan', (results) => {
  const total = results.reduce((n, r) => n + r.totalIssues, 0);
  console.log(`Static scan: ${total} issue(s)`);
});

agent.on('audit', (result) => {
  console.log(`npm audit: ${result.suggestions?.length ?? 0} high/critical CVE(s)`);
});
```

> [!NOTE]
> `DiagnosticAgent` calls `setMaxListeners(0)` internally — you can attach as many listeners as needed without triggering Node's memory leak warning.

---

## Environment Variables

All thresholds can be overridden without code changes, making the agent CI/CD and container-friendly:

| Variable | Default | Controls |
|---|---|---|
| `DIAGNOSTIC_AGENT_ENABLED` | `true` | Set to `false` or `0` for a zero-CPU-overhead global kill-switch |
| `RUNTIME_MONITOR_EVENT_LOOP_THRESHOLD_MS` | `50` | Minimum lag (ms) before an event-loop anomaly fires |
| `RUNTIME_MONITOR_MEMORY_GROWTH_BYTES` | `10485760` (10 MB) | Minimum heap growth before a memory-leak anomaly fires |
| `RUNTIME_MONITOR_CPU_PROFILE_COOLDOWN_MS` | `60000` | Minimum ms between back-to-back CPU profiles |
| `RUNTIME_MONITOR_CHECK_INTERVAL_MS` | `1000` | How often thresholds are polled |
| `RUNTIME_MONITOR_CPU_PROFILE_DURATION_MS` | `500` | Duration of each CPU profile capture |

> [!TIP]
> Malformed values (non-numeric, `0`, negative) are silently ignored and replaced with the default. This means misconfigured infrastructure cannot accidentally disable monitoring.

---

## Production Safety Reference

| Method | Prod Safe? | Resource Impact | Description |
|---|---|---|---|
| `DiagnosticAgent.createProfile(config)` | ✅ Yes | N/A | Pre-configured instance from env/app presets |
| `DiagnosticAgent.create()` | ✅ Yes | N/A | Unconfigured fluent builder |
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
| `.withStaticScanner(dir)` | ❌ **No** | High | Background `tsc`/ESLint scan. **DEV ONLY.** |
| `.withAuditScanner(dir)` | ❌ **No** | High | Spawns `npm audit`. **DEV/startup ONLY.** |
| `.withExporter(config)` | ✅ Yes | Very Low | OTLP JSON export over mTLS |
| `.withAggregatorWindow(ms)` | ✅ Yes | None | Override p99 sliding window (default: 60 s) |
| `.withEntropyThreshold(n)` | ✅ Yes | None | Override Shannon entropy threshold (default: 4.0) |
| `.start()` | — | — | Async — initialize all subsystems and begin monitoring |
| `.stop()` | — | — | Sync — tear down and flush remaining telemetry |

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
┌─────────────────────────────────────────────────────┐
│                  DiagnosticAgent                     │  ← Fluent builder / event bus
├─────────────┬──────────────────────┬────────────────┤
│ Profiling   │  Instrumentation     │  Analysis      │
│ ─────────── │  ────────────────── │  ────────────  │
│ RuntimeMon  │  InstrumentEngine   │  QueryAnalyzer │
│ CrashGuard  │  16 DB Drivers      │  StaticScanner │
│ LeakMonitor │  HttpTracer         │  AuditScanner  │
│ SrcMapRes.  │  FsTracer / Logger  │                │
├─────────────┴──────────────────────┴────────────────┤
│          AstSanitizer + EntropyChecker              │  ← Privacy firewall (always on)
├─────────────────────────────────────────────────────┤
│        MetricsAggregator (p99 sliding window)        │
├─────────────────────────────────────────────────────┤
│              OTLPExporter (mTLS)                     │
└─────────────────────────────────────────────────────┘
```

---

## Project Structure

```
src/
  index.ts                         → Public API barrel export
  diagnostic-agent.ts              → Fluent builder + createProfile API

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

  instrumentation/
    safe-channel.ts                → Backward-compatible diagnostics_channel loader (Node 14.18+)
    engine.ts                      → Core InstrumentationEngine
    correlation.ts                 → AsyncLocalStorage request context & correlationId
    http.ts                        → HTTP tracing (channel path Node 18+; monkey-patch Node 14–17)
    fs.ts                          → File system operation tracing
    logger.ts                      → console.* override with entropy scrubbing
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
    fs-analyzer.ts                 → Sync FS blocker & path traversal detection
    http-analyzer.ts               → Insecure URL & slow request detection
    log-analyzer.ts                → Log storm & payload size detection
    circuit-breaker-detector.ts    → Sustained error-rate detection across drivers
    static-scanner.ts              → Background tsc / ESLint issue tracking
    audit-scanner.ts               → npm audit CVE scanning

  export/
    aggregator.ts                  → p99 sliding window metric aggregation
    exporter.ts                    → OTLP JSON formatter + mTLS transport

tests/                             → Mirrors src/ structure (373 tests, 86 suites)
```

---

## Low-Level API

All subsystems are exported individually for advanced composition:

```typescript
import {
  // Profiling
  SourceMapResolver,
  RuntimeMonitor,
  CrashGuard,
  GracefulShutdown,
  ResourceLeakMonitor,
  SlowRequireDetector,
  StreamLeakDetector,
  WorkerThreadsMonitor,

  // Instrumentation
  InstrumentationEngine,
  HttpInstrumentation,
  FsInstrumentation,
  Logger,

  // Sanitization
  AstSanitizer,
  EntropyChecker,

  // Analysis
  QueryAnalyzer,
  HttpAnalyzer,
  FsAnalyzer,
  LogAnalyzer,
  CircuitBreakerDetector,

  // Export
  MetricsAggregator,
  OTLPExporter,
} from 'argus';

// Example: standalone entropy checker
import { EntropyChecker } from 'argus';
const checker = new EntropyChecker();
const sanitized = checker.scrub('Bearer eyJhbGc...');  // → 'Bearer [REDACTED]'

// Example: standalone circuit-breaker detector
import { CircuitBreakerDetector } from 'argus';
const cbd = new CircuitBreakerDetector();
const suggestions = cbd.analyze(recentQueryEvents);
```

> **Source mode (contributors):** replace `'argus'` with `'./src/index.ts'` and run with `node --experimental-strip-types` on Node 22.6+.

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
const agent = await DiagnosticAgent.createProfile({ environment: 'dev', appType: ['web', 'db'] })
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
