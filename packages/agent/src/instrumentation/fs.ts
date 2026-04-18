import { EventEmitter } from "node:events";
import { FsAnalyzer } from "../analysis/fs-analyzer.ts";
import type { FixSuggestion } from "../analysis/types.ts";

import fs from "node:fs";

/**
 * CAUTION: File System instrumentation can carry significant overhead.
 * It is marked Prod Safe: false.
 */

export interface TracedFsOperation {
  method: string;
  path: string;
  durationMs: number;
  sourceLine?: string;
  timestamp: number;
  suggestions?: FixSuggestion[];
}

type FsMethod = (...args: unknown[]) => unknown;

export class FsInstrumentation extends EventEmitter {
  private analyzer = new FsAnalyzer();
  private active = false;
  private getSourceLine: () => string | undefined;
  private originalMethods = new Map<string, FsMethod>();

  constructor(getSourceLine: () => string | undefined) {
    super();
    this.getSourceLine = getSourceLine;
  }

  on(event: "fs", listener: (op: TracedFsOperation) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  public enable(): void {
    if (this.active) return;

    try {
      const methodsToPatch = [
        "readFileSync",
        "writeFileSync",
        "appendFileSync",
        "readFile",
        "writeFile",
        "appendFile",
      ] as const;

      for (const method of methodsToPatch) {
        if (typeof fs[method] === "function" && !this.originalMethods.has(method)) {
          this.originalMethods.set(method, fs[method] as FsMethod);
          (fs as Record<string, unknown>)[method] = this.createPatch(
            method,
            fs[method] as FsMethod,
          );
        }
      }

      this.active = true;
    } catch {
      // Ignore if env strictly restricts fs access
    }
  }

  private createPatch(methodName: string, original: FsMethod): FsMethod {
    return (...args: unknown[]) => {
      const start = performance.now();
      const firstArg = args[0];
      const filePath =
        typeof firstArg === "string"
          ? firstArg
          : firstArg instanceof URL
            ? firstArg.pathname
            : "unknown";
      const sourceLine = this.getSourceLine();

      const lastArg = args[args.length - 1];
      if (typeof lastArg === "function") {
        args[args.length - 1] = (...cbArgs: unknown[]) => {
          this.record(methodName, filePath, start, sourceLine);
          return (lastArg as FsMethod)(...cbArgs);
        };
        return original(...args);
      } else {
        try {
          return original(...args);
        } finally {
          this.record(methodName, filePath, start, sourceLine);
        }
      }
    };
  }

  private record(method: string, path: string, start: number, sourceLine?: string) {
    const durationMs = performance.now() - start;
    const suggestions = this.analyzer.analyze(method, path);

    const traced: TracedFsOperation = {
      method,
      path,
      durationMs,
      sourceLine,
      timestamp: Date.now(),
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };

    this.emit("fs", traced);
  }

  public disable(): void {
    if (!this.active) return;
    try {
      for (const [method, original] of this.originalMethods.entries()) {
        (fs as Record<string, unknown>)[method] = original;
      }
      this.originalMethods.clear();
      this.active = false;
    } catch {}
  }
}
