/**
 * Console debug logger for ArgusAgent.
 *
 * Extracted from ArgusAgent to keep the main class focused on lifecycle.
 * When DIAGNOSTIC_DEBUG=true the agent calls installConsoleLogger() once during
 * start() — all registered listeners are returned so the agent can remove them
 * on stop() without leaking event subscriptions.
 */

import type { EventEmitter } from "node:events";
import type { SlowQueryRecord } from "../analysis/slow-query-monitor.ts";
import type { GcPressureEvent } from "../profiling/gc-monitor.ts";
import type { PoolExhaustionEvent, SlowAcquireEvent } from "../profiling/pool-monitor.ts";

/** An [eventName, listener] pair that can be passed to emitter.off() for cleanup. */
export type DebugListener = [string, (...args: unknown[]) => void];

/**
 * Registers coloured console output for every agent event and returns the
 * registered listener pairs so the caller can remove them on shutdown.
 *
 * @param emitter   The ArgusAgent instance (typed as EventEmitter to avoid circular dep).
 * @param prefix    Log line prefix — default `"[DiagAgent]"`.
 * @param level     `"warn"` — anomalies/crashes/errors only.
 *                  `"verbose"` — also logs every query and HTTP request.
 */
export function installConsoleLogger(
  emitter: EventEmitter,
  prefix: string,
  level: "warn" | "verbose",
): DebugListener[] {
  const listeners: DebugListener[] = [];

  function add(event: string, fn: (...args: unknown[]) => void): void {
    emitter.on(event, fn);
    listeners.push([event, fn]);
  }

  add("anomaly", (a) => {
    const ev = a as { type: string };
    console.warn(`${prefix} ANOMALY type=${ev.type}`, a);
  });
  add("leak", (l) => {
    const ev = l as { handlesCount: number };
    console.warn(`${prefix} LEAK    handles=${ev.handlesCount}`);
  });
  add("crash", (c) => {
    const ev = c as { error?: Error };
    console.error(`${prefix} CRASH   ${ev.error?.message ?? String(c)}`);
  });
  add("error", (e) => {
    const ev = e as Error | undefined;
    console.error(`${prefix} ERROR   ${ev?.message ?? String(e)}`);
  });
  add("info", (m) => {
    console.info(`${prefix} INFO    ${String(m)}`);
  });
  add("log", (l) => {
    const ev = l as { scrubbed: boolean; level: string };
    if (ev.scrubbed)
      console.warn(`${prefix} SCRUB   console.${ev.level} contained secrets — redacted`);
  });
  add("slow-query", (s) => {
    const ev = s as SlowQueryRecord;
    console.warn(
      `${prefix} SLOW    [${ev.durationMs.toFixed(1)}ms > ${ev.thresholdMs}ms] driver=${ev.driver} — ${ev.sanitizedQuery}`,
    );
  });
  add("gc-pressure", (g) => {
    const ev = g as GcPressureEvent;
    console.warn(
      `${prefix} GC      [${ev.totalPauseMs.toFixed(1)}ms | ${ev.pausePct.toFixed(1)}% of ${ev.windowMs}ms window] ${ev.gcCount} cycles`,
    );
  });
  add("pool-exhaustion", (p) => {
    const ev = p as PoolExhaustionEvent;
    console.warn(
      `${prefix} POOL    [${ev.driver}] waiting=${ev.waitingCount} idle=${ev.idleCount} total=${ev.totalCount}`,
    );
  });
  add("slow-acquire", (s) => {
    const ev = s as SlowAcquireEvent;
    console.warn(`${prefix} POOL    [${ev.driver}] slow acquire ${ev.waitMs.toFixed(0)}ms`);
  });

  if (level === "verbose") {
    add("query", (q) => {
      const ev = q as {
        durationMs: number;
        sanitizedQuery: string;
        suggestions?: { message: string }[];
      };
      const hints = ev.suggestions?.map((s) => s.message).join(" | ");
      const suffix = hints ? `\n  ⚠ ${hints}` : "";
      console.log(
        `${prefix} QUERY   [${ev.durationMs.toFixed(1)}ms] ${ev.sanitizedQuery}${suffix}`,
      );
    });
    add("http", (r) => {
      const ev = r as { method: string; url: string; statusCode?: number; durationMs: number };
      console.log(
        `${prefix} HTTP    ${ev.method} ${ev.url} → ${ev.statusCode ?? "---"} (${ev.durationMs.toFixed(1)}ms)`,
      );
    });
  }

  return listeners;
}
