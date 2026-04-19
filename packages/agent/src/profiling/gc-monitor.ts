import { PerformanceObserver } from "node:perf_hooks";
import { EventEmitter } from "node:events";

export interface GcMonitorOptions {
  /** Sliding window duration in ms over which GC pressure is calculated. Default: 10 000. */
  windowMs?: number;
  /** Fire 'gc-pressure' when GC consumes ≥ this % of the window. Default: 10. */
  pausePctThreshold?: number;
}

export interface GcPressureEvent {
  /** Total GC pause time within the window (ms). */
  totalPauseMs: number;
  /** Percentage of the window spent in GC (0–100). */
  pausePct: number;
  /** Number of GC cycles recorded in the window. */
  gcCount: number;
  /** Window duration used for this calculation (ms). */
  windowMs: number;
  timestamp: number;
}

interface GcSample {
  pauseMs: number;
  at: number;
}

/**
 * Observes GC performance entries and fires a 'gc-pressure' event when the
 * accumulated pause time within a sliding window exceeds a configurable
 * percentage threshold.
 *
 * ✅ Prod Safe: Yes
 * 📊 Resource Impact: Very Low (PerformanceObserver runs off the main thread)
 */
export class GcMonitor extends EventEmitter {
  private readonly windowMs: number;
  private readonly threshold: number;
  private observer: PerformanceObserver | null = null;
  private samples: GcSample[] = [];
  private active = false;

  constructor(options: GcMonitorOptions = {}) {
    super();
    this.windowMs = options.windowMs ?? 10_000;
    this.threshold = options.pausePctThreshold ?? 10;
  }

  public start(): void {
    if (this.active) return;

    this.observer = new PerformanceObserver((list) => {
      const now = Date.now();
      for (const entry of list.getEntries()) {
        this.samples.push({ pauseMs: entry.duration, at: now });
      }
      this.evaluate();
    });

    try {
      this.observer.observe({ type: "gc", buffered: false });
    } catch {
      // GC entries may be unavailable in some environments (e.g. worker threads)
      this.observer.disconnect();
      this.observer = null;
      return;
    }

    this.active = true;
  }

  public stop(): void {
    if (!this.active) return;
    this.observer?.disconnect();
    this.observer = null;
    this.samples = [];
    this.active = false;
  }

  /** Returns true if the monitor has been started and not yet stopped. */
  public get isActive(): boolean {
    return this.active;
  }

  /**
   * Injects a synthetic GC pause sample for testing purposes.
   * In production, samples are populated automatically by the PerformanceObserver.
   */
  public _injectGcPause(pauseMs: number, at: number = Date.now()): void {
    this.samples.push({ pauseMs, at });
    this.evaluate();
  }

  private evaluate(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter((s) => s.at >= cutoff);

    if (this.samples.length === 0) return;

    const totalPauseMs = this.samples.reduce((sum, s) => sum + s.pauseMs, 0);
    const pausePct = (totalPauseMs / this.windowMs) * 100;

    if (pausePct >= this.threshold) {
      this.emit("gc-pressure", {
        totalPauseMs,
        pausePct,
        gcCount: this.samples.length,
        windowMs: this.windowMs,
        timestamp: now,
      } satisfies GcPressureEvent);
      // Reset after firing so the same pauses don't re-trigger
      this.samples = [];
    }
  }
}
