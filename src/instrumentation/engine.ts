import diagnostics_channel from "node:diagnostics_channel";
import { EventEmitter } from "node:events";
import { AstSanitizer } from "../sanitization/ast-sanitizer.ts";

export interface TracedQuery {
  sanitizedQuery: string;
  durationMs: number;
  sourceLine?: string;
  timestamp: number;
}

export interface InstrumentationOptions {
  /** Additional diagnostics_channel names to subscribe to. */
  channels?: string[];
  /** If true, auto-patch popular DB drivers (pg, mysql2). Off by default. */
  autoPatching?: boolean;
}

export class InstrumentationEngine extends EventEmitter {
  private activeSubscriptions = new Map<string, diagnostics_channel.ChannelListener>();
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
    // Avoid duplicate subscription
    if (this.activeSubscriptions.has(name)) return;

    this.subscribeToChannel(name, (message: any) => {
      if (message && typeof message.query === "string") {
        this.emit("query", this.processQueryDetails(message.query, message.durationMs || 0));
      }
    });
  }

  public disable(): void {
    for (const [name, listener] of this.activeSubscriptions.entries()) {
      const channel = diagnostics_channel.channel(name);
      channel.unsubscribe(listener);
    }
    this.activeSubscriptions.clear();
  }

  private subscribeToChannel(name: string, listener: diagnostics_channel.ChannelListener) {
    const channel = diagnostics_channel.channel(name);
    channel.subscribe(listener);
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

      const traced: TracedQuery = {
        sanitizedQuery: this.sanitizeQuery(query),
        durationMs,
        sourceLine,
        timestamp: Date.now(),
      };

      this.emit("query", traced);
      return result;
    } catch (err) {
      const durationMs = performance.now() - start;
      this.emit("query", {
        sanitizedQuery: this.sanitizeQuery(query) + " [FAILED]",
        durationMs,
        sourceLine,
        timestamp: Date.now(),
      } satisfies TracedQuery);
      throw err;
    }
  }

  public processQueryDetails(rawQuery: string, durationMs: number): TracedQuery {
    return {
      sanitizedQuery: this.sanitizeQuery(rawQuery),
      durationMs,
      sourceLine: this.extractSourceLine(),
      timestamp: Date.now(),
    };
  }

  /**
   * Sanitizes SQL/NoSQL queries to strip hardcoded values and parameters
   */
  public sanitizeQuery(query: string): string {
    try {
      return this.astSanitizer.stripSql(query);
    } catch (err) {
      // Fallback regex if AST parsing fails
      return (
        query
          .replace(/'(?:[^'\\]|\\.)*'/g, "'?'")
          .replace(/"(?:[^"\\]|\\.)*"/g, '"?"')
          .replace(/\b\d+\b/g, "?")
          .replace(/\s+/g, " ")
          .trim()
      );
    }
  }

  /**
   * Gathers the exact line in source code calling this library
   */
  public extractSourceLine(): string | undefined {
    const backup = Error.prepareStackTrace;
    let stack: any;
    try {
      Error.prepareStackTrace = (_, s) => s;
      const err = new Error();
      Error.captureStackTrace(err);
      stack = err.stack as unknown as NodeJS.CallSite[];
    } finally {
      Error.prepareStackTrace = backup;
    }

    if (!Array.isArray(stack)) {
      // Fallback for when we couldn't hook V8 stack trace cleanly
      const stackStr = new Error().stack || "";
      const lines = stackStr.split("\n");
      for (const line of lines) {
        if (
          line.includes("src") && line.includes("instrumentation") ||
          line.includes("node:internal") ||
          !line.trim().startsWith("at")
        ) {
          continue;
        }
        return line.trim();
      }
      return undefined;
    }

    for (const frame of stack) {
      const filename = frame.getFileName() || "";
      // Exclude node internal, module internal, & V8 internals
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
