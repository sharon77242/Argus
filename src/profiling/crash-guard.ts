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

  private handleUnhandledRejection = (reason: any) => {
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
          ? 'An async Promise rejected without a .catch() or try/catch block, tearing down the container.'
          : 'A synchronous exception bypassed all try/catch blocks.',
        suggestedFix: 'Wrap the offending call in a try/catch or attach a .catch() to the Promise.',
      }
    ];

    const event: CrashEvent = { type, error, resolvedStack, suggestions };
    this.emit('crash', event);

    // Give telemetry buffer 100ms to flush anomalies via synchronous sockets or pending fetches
    // before physically shutting down the container
    setTimeout(() => {
      // In tests, we do not want to actually kill the runner, so we rely on test modes to mock process
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
    }, 100);
  }
}
