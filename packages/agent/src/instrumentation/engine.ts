import { EventEmitter } from "node:events";
import { safeChannel } from "./safe-channel.ts";
import { AstSanitizer } from "../sanitization/ast-sanitizer.ts";
import { getCurrentContext } from "./correlation.ts";

export interface TracedQuery {
  sanitizedQuery: string;
  durationMs: number;
  /** Driver name as reported by the patch (e.g. 'pg', 'redis', 'mongodb'). Absent for manual traceQuery() calls. */
  driver?: string;
  sourceLine?: string;
  timestamp: number;
  correlationId?: string;
  /** W3C trace-id — present when the query executes inside a runWithContext() scope. */
  traceId?: string;
}

export interface InstrumentationOptions {
  /** Additional diagnostics_channel names to subscribe to. */
  channels?: string[];
  /** If true, auto-patch popular DB drivers (pg, mysql2). Off by default. */
  autoPatching?: boolean;
}

export class InstrumentationEngine extends EventEmitter {
  private activeSubscriptions = new Map<string, (msg: unknown) => void>();
  private astSanitizer = new AstSanitizer();
  private options: InstrumentationOptions;

  constructor(options: InstrumentationOptions = {}) {
    super();
    this.options = options;
  }

  public enable(): void {
    // Default channel
    this.subscribeToQueryChannel("db.query.execution");

    // User-provided custom channels
    if (this.options.channels) {
      for (const ch of this.options.channels) {
        this.subscribeToQueryChannel(ch);
      }
    }
  }

  private subscribeToQueryChannel(name: string): void {
    if (this.activeSubscriptions.has(name)) return;

    this.subscribeToChannel(name, (message: unknown) => {
      const msg = message as Record<string, unknown>;
      if (typeof msg.query === "string") {
        const duration = typeof msg.durationMs === "number" ? msg.durationMs : 0;
        const driver = typeof msg.driver === "string" ? msg.driver : undefined;
        this.emit("query", this.processQueryDetails(msg.query, duration, driver));
      }
    });
  }

  public disable(): void {
    for (const [name, listener] of this.activeSubscriptions.entries()) {
      safeChannel(name).unsubscribe(listener);
    }
    this.activeSubscriptions.clear();
  }

  private subscribeToChannel(name: string, listener: (msg: unknown) => void) {
    safeChannel(name).subscribe(listener);
    this.activeSubscriptions.set(name, listener);
  }

  /**
   * Method for users to manually wrap queries if their driver lacks diagnostics_channel support.
   */
  public async traceQuery<T>(query: string, executeFn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const sourceLine = this.extractSourceLine();

    try {
      const result = await executeFn();
      const durationMs = performance.now() - start;

      const ctx = getCurrentContext();
      const traced: TracedQuery = {
        sanitizedQuery: this.sanitizeQuery(query),
        durationMs,
        sourceLine,
        timestamp: Date.now(),
        correlationId: ctx?.requestId,
        traceId: ctx?.traceId,
      };

      this.emit("query", traced);
      return result;
    } catch (err) {
      const durationMs = performance.now() - start;
      const ctx = getCurrentContext();
      this.emit("query", {
        sanitizedQuery: this.sanitizeQuery(query) + " [FAILED]",
        durationMs,
        sourceLine,
        timestamp: Date.now(),
        correlationId: ctx?.requestId,
        traceId: ctx?.traceId,
      } satisfies TracedQuery);
      throw err;
    }
  }

  public processQueryDetails(rawQuery: string, durationMs: number, driver?: string): TracedQuery {
    const ctx = getCurrentContext();
    return {
      sanitizedQuery: this.sanitizeQuery(rawQuery),
      durationMs,
      driver,
      sourceLine: this.extractSourceLine(),
      timestamp: Date.now(),
      correlationId: ctx?.requestId,
      traceId: ctx?.traceId,
    };
  }

  /**
   * Sanitizes SQL/NoSQL queries to strip hardcoded values and parameters
   */
  public sanitizeQuery(query: string): string {
    try {
      return this.astSanitizer.stripSql(query);
    } catch {
      // Fallback regex if AST parsing fails
      return query
        .replace(/'(?:[^'\\]|\\.)*'/g, "'?'")
        .replace(/"(?:[^"\\]|\\.)*"/g, '"?"')
        .replace(/\b\d+\b/g, "?")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  /**
   * Gathers the exact line in source code calling this library
   */
  public extractSourceLine(): string | undefined {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const backup: typeof Error.prepareStackTrace = Error.prepareStackTrace;
    let stack: unknown;
    try {
      Error.prepareStackTrace = (_err, s) => s;
      const err = new Error();
      Error.captureStackTrace(err);
      stack = err.stack as unknown as NodeJS.CallSite[];
    } finally {
      Error.prepareStackTrace = backup;
    }

    if (!Array.isArray(stack)) {
      const stackStr = new Error().stack ?? "";
      const lines = stackStr.split("\n");
      for (const line of lines) {
        if (
          (line.includes("src") && line.includes("instrumentation")) ||
          line.includes("node:internal") ||
          !line.trim().startsWith("at")
        ) {
          continue;
        }
        return line.trim();
      }
      return undefined;
    }

    for (const frame of stack as NodeJS.CallSite[]) {
      const filename = frame.getFileName() ?? "";
      if (
        !(filename.includes("src") && filename.includes("instrumentation")) &&
        !filename.startsWith("node:") &&
        !filename.includes("node_modules")
      ) {
        return `${filename}:${frame.getLineNumber()}:${frame.getColumnNumber()}`;
      }
    }

    return undefined;
  }
}
