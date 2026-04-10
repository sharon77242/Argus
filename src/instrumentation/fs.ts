import { EventEmitter } from 'node:events';
import { FsAnalyzer } from '../analysis/fs-analyzer.ts';
import type { FixSuggestion } from '../analysis/types.ts';

import fs from 'node:fs';

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

export class FsInstrumentation extends EventEmitter {
  private analyzer = new FsAnalyzer();
  private active = false;
  private getSourceLine: () => string | undefined;
  private originalMethods = new Map<string, Function>();

  constructor(getSourceLine: () => string | undefined) {
    super();
    this.getSourceLine = getSourceLine;
  }

  public enable(): void {
    if (this.active) return;
    
    try {
      const methodsToPatch = [
        'readFileSync', 'writeFileSync', 'appendFileSync',
        'readFile', 'writeFile', 'appendFile'
      ] as const;

      for (const method of methodsToPatch) {
        if (typeof fs[method] === 'function' && !this.originalMethods.has(method)) {
          this.originalMethods.set(method, fs[method] as Function);
          (fs as any)[method] = this.createPatch(method, fs[method] as Function);
        }
      }

      this.active = true;
    } catch {
      // Ignore if env strictly restricts fs access
    }
  }

  private createPatch(methodName: string, original: Function): Function {
    const self = this;
    return function (...args: any[]) {
      const start = performance.now();
      const filePath = typeof args[0] === 'string' ? args[0] : (args[0]?.toString() || 'unknown');
      const sourceLine = self.getSourceLine();

      // If it's an async callback function
      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'function') {
        args[args.length - 1] = function (...cbArgs: any[]) {
          self.record(methodName, filePath, start, sourceLine);
          return lastArg.apply(this, cbArgs);
        };
        return original.apply(this, args);
      } else {
        // Sync operation
        try {
          return original.apply(this, args);
        } finally {
          self.record(methodName, filePath, start, sourceLine);
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

    this.emit('fs', traced);
  }

  public disable(): void {
    if (!this.active) return;
    try {
      for (const [method, original] of this.originalMethods.entries()) {
        (fs as any)[method] = original;
      }
      this.originalMethods.clear();
      this.active = false;
    } catch {}
  }
}
