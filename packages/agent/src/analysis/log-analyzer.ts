import type { FixSuggestion } from './types.ts';

export class LogAnalyzer {
  private recentErrors = { count: 0, firstSeen: 0 };
  private readonly ERROR_WINDOW_MS = 1000;
  private readonly ERROR_THRESHOLD = 5;

  public analyze(args: unknown[], level = 'log'): FixSuggestion[] {
    const suggestions: FixSuggestion[] = [];

    // 1. Unstructured Logging Warning
    // If the user logs a combination of strings and objects natively, it's hard to parse.
    let hasString = false;
    let hasObject = false;

    for (const arg of args) {
      if (typeof arg === 'string') hasString = true;
      else if (typeof arg === 'object' && arg !== null) hasObject = true;
    }

    if (hasString && hasObject && args.length > 1) {
      suggestions.push({
        severity: 'info',
        rule: 'unstructured-log',
        message: 'Mixing raw strings and objects in console logs makes parsing difficult in production log aggregators.',
        suggestedFix: 'Consider using a structured JSON logger like pino, or stringify objects contextually.',
      });
    }

    // 2. Very large objects
    const totalSizeEstimate = JSON.stringify(args).length;
    if (totalSizeEstimate > 5000) {
      suggestions.push({
        severity: 'warning',
        rule: 'large-log-payload',
        message: `Log payload is very large (~${(totalSizeEstimate / 1024).toFixed(1)}KB). Syncing this to stdout can block the Event Loop.`,
        suggestedFix: 'Avoid logging huge objects/arrays. Extract specific IDs or metadata instead.',
      });
    }

    // 3. Error Storm Monitoring
    if (level === 'error') {
      const now = Date.now();
      if (now - this.recentErrors.firstSeen <= this.ERROR_WINDOW_MS) {
        this.recentErrors.count++;
        if (this.recentErrors.count === this.ERROR_THRESHOLD) {
          suggestions.push({
            severity: 'critical',
            rule: 'log-error-storm',
            message: `Detected ${this.recentErrors.count} error logs within ${this.ERROR_WINDOW_MS}ms.`,
            suggestedFix: 'Investigate the root cause immediately to prevent log flooding and degraded performance. Consider debouncing repetitive error stacks.',
          });
        }
      } else {
        this.recentErrors.count = 1;
        this.recentErrors.firstSeen = now;
      }
    }

    return suggestions;
  }
}
