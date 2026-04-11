import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

export interface AggregatorEvent {
  id: string;
  metricName: string;
  value: number;
  payload: any;
}

export class MetricsAggregator extends EventEmitter {
  private buffer: AggregatorEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private windowMs: number;

  constructor(windowMs: number = 60000) {
    super();
    this.windowMs = windowMs;
  }

  public enable(): void {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => this.flush(), this.windowMs);
    this.flushInterval.unref(); // Don't block process exit
  }

  public disable(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush(); // Flush remaining items on shutdown
  }

  public record(metricName: string, value: number, payload: any): void {
    this.buffer.push({
      id: crypto.randomUUID(),
      metricName,
      value,
      payload
    });
  }

  public flush(): void {
    if (this.buffer.length === 0) return;
    
    // Group events by their metric type to calculate separate p99s
    const groups = new Map<string, AggregatorEvent[]>();
    for (const event of this.buffer) {
      const g = groups.get(event.metricName) || [];
      g.push(event);
      groups.set(event.metricName, g);
    }
    
    // Rotate buffer
    this.buffer = [];

    const outliersToExport: AggregatorEvent[] = [];

    for (const [metricName, events] of groups.entries()) {
      // If traffic is very low during this window, just export everything (up to 5 items)
      // to ensure we still have visibility into critical but rare issues
      if (events.length <= 5) {
        outliersToExport.push(...events);
        continue;
      }
      
      // Sort ascending by metric value (e.g. latency, memory growth bytes)
      events.sort((a, b) => a.value - b.value);
      
      // Calculate p99 index.
      // Math.ceil(0.99 * n) - 1 correctly yields the 99th-percentile boundary.
      // Example: n=100 → ceil(99) - 1 = 98 (the 99th item, 0-indexed).
      // (The old Math.floor formula gave index 99 = the max = p100.)
      const p99Index = Math.ceil(0.99 * events.length) - 1;
      
      // Push only the outliers (p99 and above)
      for (let i = p99Index; i < events.length; i++) {
        outliersToExport.push(events[i]);
      }
    }

    if (outliersToExport.length > 0) {
      this.emit('flush', outliersToExport);
    }
  }
}
