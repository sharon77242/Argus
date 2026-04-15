// Profiling
export * from "./profiling/source-map-resolver.ts";
export * from "./profiling/runtime-monitor.ts";
export * from "./profiling/crash-guard.ts";
export * from "./profiling/resource-leak-monitor.ts";
export * from "./profiling/app-type-detector.ts";
export * from "./profiling/graceful-shutdown.ts";
export * from "./profiling/worker-threads-monitor.ts";
export * from "./profiling/slow-require-detector.ts";
export * from "./profiling/stream-leak-detector.ts";

// Instrumentation
export * from "./instrumentation/engine.ts";
export * from "./instrumentation/drivers/index.ts";
export * from "./instrumentation/http.ts";
export * from "./instrumentation/fs.ts";
export * from "./instrumentation/logger.ts";
export * from "./instrumentation/correlation.ts";

// Sanitization
export * from "./sanitization/ast-sanitizer.ts";
export * from "./sanitization/entropy-checker.ts";

// Export
export * from "./export/aggregator.ts";
export * from "./export/exporter.ts";

// Analysis
export * from "./analysis/types.ts";
export * from "./analysis/query-analyzer.ts";
export * from "./analysis/static-scanner.ts";
export * from "./analysis/http-analyzer.ts";
export * from "./analysis/log-analyzer.ts";
export * from "./analysis/fs-analyzer.ts";
export * from "./analysis/audit-scanner.ts";
export * from "./analysis/circuit-breaker-detector.ts";

// Licensing
export * from "./licensing/public-key.ts";
export * from "./licensing/license-validator.ts";
export * from "./licensing/clock-guard.ts";
export * from "./licensing/expiry-signal.ts";

// Top-level builder
export * from "./diagnostic-agent.ts";
