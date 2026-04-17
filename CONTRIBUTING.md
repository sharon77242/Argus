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

---

## Submitting a pull request

1. Fork the repo and create a feature branch from `main`.
2. Make your changes; add or update tests.
3. Run `pnpm test && pnpm typecheck && pnpm lint` — all must pass.
4. Open a PR with a clear description of what you changed and why.
5. Reference any related issue numbers in the PR description.

For large changes, open an issue first to discuss the approach before writing code.
