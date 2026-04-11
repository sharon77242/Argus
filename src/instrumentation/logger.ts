import { EventEmitter } from 'node:events';
import { LogAnalyzer } from '../analysis/log-analyzer.ts';
import { EntropyChecker } from '../sanitization/entropy-checker.ts';
import type { FixSuggestion } from '../analysis/types.ts';

export interface TracedLog {
  level: string;
  durationMs: number;
  argsLength: number;
  scrubbed: boolean;
  sourceLine?: string;
  timestamp: number;
  suggestions?: FixSuggestion[];
}

export interface LoggerOptions {
  scrubContext?: boolean;
  entropyThreshold?: number;
}

type ConsoleMethod = (...args: unknown[]) => void;

export class LoggerInstrumentation extends EventEmitter {
  private analyzer = new LogAnalyzer();
  private active = false;
  private getSourceLine: () => string | undefined;
  private originalLoggers = new Map<string, ConsoleMethod>();
  private options: LoggerOptions;

  constructor(getSourceLine: () => string | undefined, options: LoggerOptions = {}) {
    super();
    this.getSourceLine = getSourceLine;
    this.options = { scrubContext: true, entropyThreshold: 4.0, ...options };
  }

  public enable(): void {
    if (this.active) return;

    const methods = ['log', 'info', 'warn', 'error'] as const;

    for (const level of methods) {
      if (typeof console[level] === 'function' && !this.originalLoggers.has(level)) {
        this.originalLoggers.set(level, console[level] as ConsoleMethod);
        (console as unknown as Record<string, unknown>)[level] = this.createPatch(level, console[level] as ConsoleMethod);
      }
    }

    this.active = true;
  }

  private createPatch(level: string, original: ConsoleMethod): ConsoleMethod {
    return (...args: unknown[]) => {
      const start = performance.now();
      const sourceLine = this.getSourceLine();

      let scrubbed = false;

      if (this.options.scrubContext) {
        for (let i = 0; i < args.length; i++) {
          if (typeof args[i] === 'string') {
            const before = args[i] as string;
            args[i] = EntropyChecker.scrubHighEntropyStrings(before, this.options.entropyThreshold ?? 4.0);
            if (before !== args[i]) scrubbed = true;
          }
        }
      }

      const suggestions = this.analyzer.analyze(args, level);

      try {
        original.apply(console, args);
      } finally {
        const durationMs = performance.now() - start;
        const traced: TracedLog = {
          level,
          durationMs,
          argsLength: args.length,
          scrubbed,
          sourceLine,
          timestamp: Date.now(),
          suggestions: suggestions.length > 0 ? suggestions : undefined,
        };
        this.emit('log', traced);
      }
    };
  }

  public disable(): void {
    if (!this.active) return;
    const methods = ['log', 'info', 'warn', 'error'] as const;
    for (const level of methods) {
      const original = this.originalLoggers.get(level);
      if (original) {
        (console as unknown as Record<string, unknown>)[level] = original;
      }
    }
    this.originalLoggers.clear();
    this.active = false;
  }
}
