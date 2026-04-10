import { EventEmitter } from 'node:events';
import type { FixSuggestion } from '../analysis/types.ts';

export interface ResourceLeakEvent {
  handlesCount: number;
  suggestions: FixSuggestion[];
}

export interface ResourceLeakMonitorOptions {
  handleThreshold?: number;
  intervalMs?: number;
}

export class ResourceLeakMonitor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private handleThreshold: number;
  private intervalMs: number;

  constructor(options: ResourceLeakMonitorOptions = {}) {
    super();
    this.handleThreshold = options.handleThreshold || 1000;
    this.intervalMs = options.intervalMs || 5000;
  }

  public start(): void {
    if (this.timer) return;
    
    this.timer = setInterval(() => this.check(), this.intervalMs);
    this.timer.unref(); // prevent blocking event loop from natural death
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private check(): void {
    // Only available in Node v20/v22+
    if (typeof process.getActiveResourcesInfo !== 'function') {
      return;
    }

    const resources = process.getActiveResourcesInfo();
    const handlesCount = resources.length;

    if (handlesCount > this.handleThreshold) {
      const suggestions: FixSuggestion[] = [
        {
          severity: 'critical',
          rule: 'resource-exhaustion',
          message: `Process exceeded threshold of active OS handles/resources (${handlesCount} > ${this.handleThreshold}).`,
          suggestedFix: 'Ensure DB connection pools are restricted, sockets use keep-alive appropriately, and file streams are explicitly closed.',
        }
      ];

      this.emit('leak', { handlesCount, suggestions });
    }
  }
}
