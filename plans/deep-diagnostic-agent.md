# Project: Node.js/TypeScript Deep Diagnostic Agent

## 1. Project Overview & Context

You are an expert AI implementation agent acting as a Senior Backend Node.js/TypeScript Engineer. Your objective is to build the foundational architecture for a Deep Diagnostic Agent.

This agent is designed to run inside (or as a sidecar to) a Node.js container. Its primary goal is to profile the application, identify performance bottlenecks (Event Loop lag, inefficient DB queries, memory leaks), map runtime execution back to minified/transpiled code using source maps, and export strictly sanitized metadata for an external AI to analyze.

**CRITICAL RULE:** Absolute Data Privacy. No PII, database record values, secrets, or environment variables can ever be extracted. Only code structures, execution plans, and performance metrics are allowed.

## 2. Tech Stack & Environment

- **Runtime:** Node.js (v18+)
- **Language:** TypeScript
- **Key Native Modules:** `perf_hooks`, `async_hooks`, `v8`, `fs`, `inspector`
- **Target Environment:** Dockerized Node.js applications (potentially running minified/bundled code via Webpack/esbuild/Tsc).

## 3. Implementation Phases

### Phase 1: Bootstrapping & Source Map Resolution

**Goal:** Understand the environment and prepare the mapping engine efficiently.

- Implement a scanner that traverses the execution directory to find `.js` files and their corresponding `.js.map` files.
- Build a `SourceMapResolver` utility using libraries like `source-map` to translate minified runtime stack traces and function pointers back to the original TypeScript source lines.
- **Deliverable 1:** A module that initializes on startup, lazily loads source maps only when necessary (or offloads resolution to a `worker_thread` to avoid blocking), and exposes a `resolvePosition(line, column)` method.

### Phase 2: Core Profiling Engine (High Priority Bottlenecks)

**Goal:** Monitor the Node.js runtime with strict safeguards against the "Observer Effect".

- **Event Loop Monitoring:** Use `perf_hooks.monitorEventLoopDelay` to track lag. When lag exceeds a threshold (e.g., 50ms), capture a short CPU profile using the `inspector` module, strictly governed by rate-limiting, debouncing, and a cooling-off period to prevent process stalls during heavy load.
- **Memory Profiling:** Monitor heap usage. Trigger a lightweight heap snapshot if memory grows linearly, protected by similar strict frequency limits.
- **Deliverable 2:** A `RuntimeMonitor` class that safely emits events when performance thresholds are breached without overwhelming the host application, containing the exact AST node or function name causing the issue.

### Phase 3: I/O & Database Instrumentation (diagnostics_channel / Hooks)

**Goal:** Intercept and analyze external calls with near-zero overhead.

- Use `diagnostics_channel` where natively supported (e.g., modern Node `fetch`, many DB drivers) as the primary tracing mechanism. For robust tracing without monkey-patching fragility, consider intercepting at the network socket layer (e.g., parsing the PostgreSQL wire protocol) or utilizing OpenTelemetry bindings.
- **Query Analysis:** Intercept DB queries to measure execution time. Extract the SQL/NoSQL query string (e.g., `SELECT * FROM users WHERE id = $1`), but **STRIP OUT** all bound parameters (`$1` values) to maintain zero data leakage.
- **Deliverable 3:** An `InstrumentationEngine` that logs sanitized queries, their execution time, and the exact line of code that triggered them.

### Phase 4: Data Sanitization, Aggregation & Export

**Goal:** Package the findings with military-grade privacy, standard formatting, and rigorous rate-limiting.

- **Anomaly Aggregation:** Implement a statistical aggregator to solve the "AI Spam" volume problem. Build an in-memory histogram of slow traces and only export _p99 statistical outliers_ over a sliding window (e.g., 60 seconds) to avoid bankrupting AI APIs during DDOS attacks or load spikes.
- **Advanced Sanitization Pipeline:** Acting as a final gatekeeper, use AST-based parsers (e.g., `pg-query-parser`) to scrub queries. Bolster this with **generic entropy checks** to catch accidentally concatenated string secrets. Recommend an accompanying strict "Optionally Parameterized Queries" ESLint plugin to the end-users to guarantee absolute leakage prevention.
- Format the output to align with **OpenTelemetry** semantic conventions, representing the diagnostic context cleanly for broader system compatibility.
- **Deliverable 4:** An `Exporter` module that sends this aggregated telemetry to the external AI analysis engine over a secure, mutually authenticated TLS connection to ensure data cannot be intercepted or tampered with.

## 4. Execution Instructions for the AI Agent

1. Begin by creating the project structure and `tsconfig.json` optimized for a Node.js library.
2. Implement **Phase 1** first and write a unit test demonstrating a minified error stack trace being resolved to a mock `.ts` file.
3. Pause and ask for my review before moving to the instrumentation phases. Ensure your code is modular and heavily commented.
