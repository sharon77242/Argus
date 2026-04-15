import { EventEmitter } from 'node:events';
import type { FixSuggestion } from '../analysis/types.ts';

export interface CrashEvent {
  type: 'uncaughtException' | 'unhandledRejection';
  error: Error;
  resolvedStack?: string;
  suggestions?: FixSuggestion[];
}

export class CrashGuard extends EventEmitter {
  private active = false;
  private resolveStack: (stack: string) => string;

  constructor(resolveStack: (stack: string) => string = (s) => s) {
    super();
    this.resolveStack = resolveStack;
  }

  public enable(): void {
    if (this.active) return;
    this.active = true;

    process.on('uncaughtException', this.handleUncaughtException);
    process.on('unhandledRejection', this.handleUnhandledRejection);
  }

  public disable(): void {
    if (!this.active) return;
    this.active = false;
    process.removeListener('uncaughtException', this.handleUncaughtException);
    process.removeListener('unhandledRejection', this.handleUnhandledRejection);
  }

  private handleUncaughtException = (error: Error) => {
    this.handleCrash('uncaughtException', error);
  };

  private handleUnhandledRejection = (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    this.handleCrash('unhandledRejection', error);
  };

  private handleCrash(type: 'uncaughtException' | 'unhandledRejection', error: Error) {
    // If agent is disabled midway
    if (!this.active) return;

    const resolvedStack = error.stack ? this.resolveStack(error.stack) : undefined;

    const suggestions: FixSuggestion[] = [
      {
        severity: 'critical',
        rule: 'unhandled-crash',
        message: type === 'unhandledRejection'
          ? 'An async Promise rejected without a .catch() or try/catch block.'
          : 'A synchronous exception bypassed all try/catch blocks.',
        suggestedFix: 'Wrap the offending call in a try/catch or attach a .catch() to the Promise.',
      }
    ];

    const event: CrashEvent = { type, error, resolvedStack, suggestions };
    this.emit('crash', event);

    // Only uncaughtException represents an unrecoverable synchronous tear-down.
    // unhandledRejection is observable/recoverable in Node ≥ 15 and should NOT kill
    // the process — the app (or its framework) may have its own rejection handling.
    if (type === 'uncaughtException') {
      // Give telemetry buffer 100ms to flush before physically shutting down.
      setTimeout(() => {
        // In tests, we do not want to actually kill the runner.
        if (process.env.NODE_ENV !== 'test') {
          process.exit(1);
        }
      }, 100);
    }
  }
}
