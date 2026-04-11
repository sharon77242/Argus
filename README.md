# Deep Diagnostic Agent

A privacy-first, ultra-lightweight performance profiling & diagnostics agent natively built for Node.js (v22+). 

Designed to be integrated directly into your Node.js application, this agent silently tracks runtime execution, isolates bottlenecks, and mathematically sanitizes all context before exporting OpenTelemetry (OTLP) data to your AI analysis endpoint.

## Features

- **Absolute Data Privacy**: Implements multi-layered SQL/NoSQL AST sanitization and string-level **Shannon Entropy checks** to physically strip database values, PII, and leaked security tokens (JWTs, API Keys) out of telemetry data **and** `console` logs.
- **Native Zero-Compilation TypeScript**: Fully optimized around Node v22.6+ `--experimental-strip-types`, enabling strict TS typing without heavy transpile architectures.
- **Event Loop & Memory Profiling**: Native Integration with V8 and `node:perf_hooks` captures Event Loop Lag > 50ms and captures `.heapsnapshot` and `.cpuprofile` bursts completely automatically.
- **Actionable AI-Ready Diagnostics**: Enriches metrics with AST-based query analysis, background TS/ESLint issue tracking, **HTTP inspection**, and **File System blocking detection** to generate concrete fix suggestions alongside raw anomalies.
- **Statistical Throttling**: Implements p99 anomaly aggregation via sliding windows to guarantee high-value diagnostic exports without risking AI-API rate-limiting or DDoS spam scenarios.
- **Zero-Monkeypatch Instrumentation**: Hooks natively into `node:diagnostics_channel` for robust, standard-compliant query and HTTP interception without prototype pollution, supporting an auto-patching safety net across **16 databases**.

## Quick Start
*Note: This agent expects Node v22.6.0+.*

```bash
npm install
npm test           # Runs the native test suite ensuring zero-leakage constraints
```

## Architecture Layers

1. **`SourceMapResolver`:** Translates minified stack traces back to exact TypeScript code dynamically.
2. **`RuntimeMonitor`:** Listens for event loop starvation and memory leaks.
3. **`InstrumentationEngine`:** Captures DB/IO executions using standardized diagnostics channels.
4. **`AstSanitizer` & `EntropyChecker`:** The firewall. Mathematically shreds secrets from the payloads.
5. **`MetricsAggregator` & `OTLPExporter`:** Rolls data across intervals to extract p99 variants, pushing OTLP JSON via Mutually Authenticated TLS.

## Integrating into your Application

```typescript
import { DiagnosticAgent } from './src/index.ts';

// 1. Highly optimized preset Profile loading
const agent = await DiagnosticAgent.createProfile({
  enabled: process.env.NODE_ENV !== 'local', // Globally disables with ZERO CPU overhead
  environment: 'prod',                       // Auto-enables CrashGuard, LeakMonitor, etc.
  appType: ['web', 'db'],                    // Mix types — modules are unioned automatically
}).start();
```

#### Profile Presets & Optimization

The `createProfile` API uses intelligent defaults based on your environment and the nature of your application.
`appType` accepts a single type **or an array** — when multiple types are provided, their modules are **unioned** (duplicates are harmless since each `.with*()` call is idempotent):

| Category | Option | Components Enabled | Optimization Target |
| --- | --- | --- | --- |
| **Env** | `prod` | CrashGuard, LogTracing | **Stability**: Minimal overhead, high safety. |
|  | `dev`, `test` | `prod` + FsTracing, StaticScanner, AuditScanner, SourceMaps | **Forensics**: Deep blocking & security analysis. |
| **App** | `'web'` | HttpTracing, Socket Leak Monitor, Auto-Patching | **Latency**: Request/Response & Socket tracking. |
|  | `'db'` | QueryAnalysis, Connection Leak Monitor, Auto-Patching | **DataAccess**: Query patterns & connection safety. |
|  | `'worker'` | RuntimeMonitor (CPU/Mem), Handle Leak Monitor, Auto-Patching | **Throughput**: Long-running safety & loop health. |
|  | `['web','db']` | Union of `web` + `db` modules | **Hybrid**: Full HTTP + Query coverage. |
|  | `['web','db','worker']` | All modules active | **Full-Stack**: Maximum observability. |

#### Hybrid / Mixed App Types

Real-world services often fill multiple roles — an Express API that also runs background jobs, or a worker that queries a database. Pass an array to `appType` to compose their diagnostics:

```typescript
// API server that also does heavy background processing
DiagnosticAgent.createProfile({ appType: ['web', 'worker'] });

// Worker that queries databases directly
DiagnosticAgent.createProfile({ appType: ['db', 'worker'] });

// Monolith — everything
DiagnosticAgent.createProfile({ appType: ['web', 'db', 'worker'] });

// Single type still works (backward compatible)
DiagnosticAgent.createProfile({ appType: 'web' });
```

#### Auto-Detection (Default: `appType: 'auto'`)

Don't know your app type? Let the agent figure it out. By default, `appType` is set to `'auto'`, and it will scan your `package.json` dependencies against known fingerprints:

```typescript
// Scans package.json automatically → detects express=web, pg=db, bullmq=worker
const agent = await DiagnosticAgent.createProfile({
  environment: 'prod',
  // appType: 'auto' is the default
}).start();
```

You can also call the detector standalone for logging or debugging:

```typescript
const result = DiagnosticAgent.detectAppTypes('./my-service');
console.log(result);
// { types: ['web', 'db'], matches: { web: ['express', 'cors'], db: ['pg', 'ioredis'], worker: [] } }
```

**Recognized packages** (non-exhaustive):

| Type | Packages |
| --- | --- |
| `web` | express, fastify, koa, @hapi/hapi, @nestjs/core, next, nuxt, socket.io, ws, apollo-server, … |
| `db` | pg, mysql2, mongodb, mongoose, sequelize, typeorm, @prisma/client, knex, redis, ioredis, mssql, … |
| `worker` | bull, bullmq, agenda, bee-queue, pg-boss, node-cron, amqplib, kafkajs, piscina, … |

If no packages match, `'auto'` falls back to `'web'`.

### 2. OR Compose manually for fine-grained control:
```typescript
import { DiagnosticAgent } from './src/index.ts';
import fs from 'node:fs';

const manualAgent = await DiagnosticAgent.create()
  .withSourceMaps('./dist')                        
  .withRuntimeMonitor({ eventLoopThresholdMs: 50 }) 
  .withInstrumentation({ autoPatching: true })      // 16 DB drivers (MySQL, Mongo, Redis, etc)
  .withHttpTracing()                                // Detect insecure / slow HTTP requests
  .withLogTracing({ scrubContext: true })           // Shred tokens from console overrides
  .withFsTracing()                                  // [Not Prod Safe] Detects sync FS blockers
  .withCrashGuard()                                 // Catches uncaughtException/unhandledRejection gracefully
  .withResourceLeakMonitor({ handleThreshold: 5000 })// Detects OS handle/socket leaks
  .withExporter({                                   
    endpointUrl: 'https://otel.example.com/v1/traces',
    key:  fs.readFileSync('./certs/client.key'),
    cert: fs.readFileSync('./certs/client.crt'),
    ca:   fs.readFileSync('./certs/ca.crt'),
  })
  .withQueryAnalysis()                              
  .withStaticScanner(process.cwd())                 
  .withAuditScanner(process.cwd())                  // Scans for dependency vulnerabilities 
  .start();

// Listen to raw events if needed
agent.on('anomaly', (event) => console.log('Anomaly:', event.type));
agent.on('query',   (trace) => console.log('Query:', trace.sanitizedQuery));

// Manually trace a query (for drivers without diagnostics_channel support)
const rows = await agent.traceQuery('SELECT * FROM orders WHERE id = $1', async () => {
  return db.query('SELECT * FROM orders WHERE id = $1', [42]);
});

// Graceful shutdown
agent.stop();
```

Every `.with*()` method is **optional** — enable only what you need. The builder handles all internal event wiring, entropy scrubbing, and p99 aggregation automatically.

## Builder API & Production Safety Reference

| Method | Prod Safe? | Resource Impact | Description |
| --- | --- | --- | --- |
| `DiagnosticAgent.createProfile(config)`| ✅ Yes | N/A | Returns an intelligently pre-configured instance based on env/app presets |
| `DiagnosticAgent.create()` | ✅ Yes | N/A | Returns a new unconfigured builder instance |
| `.withSourceMaps(dir?)` | ✅ Yes | Very Low | Enable source-map resolution for stack traces |
| `.withRuntimeMonitor(opts?)`| ✅ Yes | Low | Enable event loop lag + memory leak detection |
| `.withCrashGuard()` | ✅ Yes | Very Low | Catch unhandled rejections/exceptions and flush telemetry before exiting |
| `.withResourceLeakMonitor()`| ✅ Yes | Low | Track OS active resources/handles to catch TCP/File connection leaks |
| `.withInstrumentation(opts?)`| ✅ Yes | Low | Enable DB/IO tracing via `diagnostics_channel` |
| `.withHttpTracing()` | ✅ Yes | Low | Enable Native HTTP tracing & slow request analysis |
| `.withLogTracing(opts?)` | ✅ Yes | Low | Overrides `console` to strip secrets & analyze logs |
| `.withFsTracing()` | ❌ **No** | **High** | Patches `fs`. Warns on *Sync blockers. DEV ONLY. |
| `.withQueryAnalysis()` | ✅ Yes | Medium (AST) | Enrich queries with N+1 patterns & fix suggestions |
| `.withStaticScanner(dir)` | ❌ **No** | **High** | Fires background `tsc`/`eslint` scans. DEV ONLY. |
| `.withAuditScanner(dir)` | ❌ **No** | **High** | Spawns `npm audit` to check dependency CVEs. DEV/Startup ONLY. |
| `.withExporter(config)` | ✅ Yes | Very Low | Ship telemetry over OTLP with mTLS |
| `.withAggregatorWindow(ms)` | Override p99 sliding window (default: 60s) |
| `.withEntropyThreshold(n)` | Override Shannon entropy secret detection threshold (default: 4.0) |
| `.start()` | Async — initialize all subsystems and begin monitoring |
| `.stop()` | Sync — tear down everything and flush remaining data |

## Project Structure

```
src/
  index.ts                         → Public API barrel export
  diagnostic-agent.ts              → Fluent builder API (recommended entry point)

  profiling/
    runtime-monitor.ts             → Event loop lag & heap snapshot profiling
    source-map-resolver.ts         → .js.map scanning & lazy resolution

  instrumentation/
    engine.ts                      → Core InstrumentationEngine class
    drivers/
      index.ts                     → Driver registry (apply / remove patches)
      patch-utils.ts               → Shared wrapping utilities & types
      pg.ts                        → PostgreSQL
      mysql.ts                     → MySQL / Aurora (mysql2)
      mongodb.ts                   → MongoDB
      bigquery.ts                  → Google BigQuery
      elasticsearch.ts             → Elasticsearch
      redis.ts                     → ioredis + node-redis
      mssql.ts                     → mssql + tedious

  sanitization/
    ast-sanitizer.ts               → SQL AST scrubbing (node-sql-parser)
    entropy-checker.ts             → Shannon entropy secret detection

  analysis/
    types.ts                       → Analysis type contracts
    query-analyzer.ts              → AST-based query fix suggestions (Level 1)
    static-scanner.ts              → Background code issue tracking (Level 2)

  export/
    aggregator.ts                  → P99 sliding window metric aggregation
    exporter.ts                    → OTLP JSON formatter + mTLS transport

tests/                             → Mirrors src/ structure (66 tests)

## Advanced: Low-Level API

For fine-grained control, all subsystem classes are exported individually:

```typescript
import {
  SourceMapResolver,
  RuntimeMonitor,
  InstrumentationEngine,
  AstSanitizer,
  EntropyChecker,
  MetricsAggregator,
  OTLPExporter,
} from './src/index.ts';
```

## License

MIT
