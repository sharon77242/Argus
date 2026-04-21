/**
 * Query event handler factory.
 *
 * Extracts the dense per-query processing logic out of ArgusAgent so that
 * wireInstrumentationEngine() becomes a lean wiring step, not a policy file.
 *
 * The handler is constructed once per agent start() and registered on the engine's
 * "query" event. All dependencies are captured at construction time via the deps bag.
 */

import type { TracedQuery } from "../instrumentation/engine.ts";
import type { AdaptiveSampler } from "../instrumentation/adaptive-sampler.ts";
import type { QueryAnalyzer } from "../analysis/query-analyzer.ts";
import type { SlowQueryMonitor } from "../analysis/slow-query-monitor.ts";
import type { MetricsAggregator } from "../export/aggregator.ts";

export interface QueryHandlerDeps {
  adaptiveSampler: AdaptiveSampler | null;
  queryAnalyzer: QueryAnalyzer | null;
  slowQueryMonitor: SlowQueryMonitor | null;
  aggregator: MetricsAggregator;
  emit: (event: string, data: unknown) => void;
}

/**
 * Returns the handler function to register on `engine.on("query", handler)`.
 *
 * Processing order for every traced query:
 *  1. Adaptive sampling — drop silently if token bucket is exhausted
 *  2. Query analysis — attach fix suggestions when analyzer is active
 *  3. Slow query monitor — check threshold, emit + record if exceeded
 *  4. Aggregator record + agent "query" event emit
 */
export function createQueryHandler(deps: QueryHandlerDeps): (traced: TracedQuery) => void {
  const { adaptiveSampler, queryAnalyzer, slowQueryMonitor, aggregator, emit } = deps;

  return function handleQuery(traced: TracedQuery): void {
    // 1. Adaptive sampling — drop event if bucket is empty
    if (adaptiveSampler && !adaptiveSampler.shouldSample("query")) return;

    // 2. Query analysis — enrich with fix suggestions
    const enriched = queryAnalyzer
      ? { ...traced, suggestions: queryAnalyzer.analyze(traced.sanitizedQuery) }
      : traced;

    // 3. Slow query monitor — driver may be absent for manual traceQuery() calls
    if (slowQueryMonitor) {
      const slow = slowQueryMonitor.check(
        traced.sanitizedQuery,
        traced.durationMs,
        traced.driver, // string | undefined — check() handles undefined gracefully
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
        emit("slow-query", slow);
      }
    }

    // 4. Always record and forward as "query" event
    aggregator.record("query", traced.durationMs, enriched as Record<string, unknown>);
    emit("query", enriched);
  };
}
