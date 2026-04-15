import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { getDiagnosticsChannel } from '../instrumentation/safe-channel.ts';

export interface WorkerPoolMetrics {
  activeWorkers: number;
  queueDepth: number;
  avgTaskDurationMs: number;
  idleWorkers: number;
}

export interface WorkerPoolEvent {
  type: 'worker-pool-anomaly';
  reason: 'queue-depth' | 'slow-task' | 'spawn-spike';
  metrics: WorkerPoolMetrics;
  thresholdExceeded: number;
  message: string;
}

export interface WorkerThreadsMonitorOptions {
  queueDepthThreshold?: number;
  slowTaskThresholdMs?: number;
  spawnSpikeThreshold?: number;
  spawnSpikeWindowMs?: number;
  pollIntervalMs?: number;
}

/**
 * Monitors worker thread pool health.
 * Emits 'anomaly' events when queue depth, task duration, or spawn rate exceed thresholds.
 *
 * Hooks into worker_threads via diagnostics_channel 'worker_threads.Worker.created' (Node 22+).
 * Falls back gracefully when the channel is unavailable.
 */
export class WorkerThreadsMonitor extends EventEmitter {
  private readonly queueDepthThreshold: number;
  private readonly slowTaskThresholdMs: number;
  private readonly spawnSpikeThreshold: number;
  private readonly spawnSpikeWindowMs: number;
  private readonly pollIntervalMs: number;

  private activeWorkers = 0;
  private queueDepth = 0;
  private taskTimings: number[] = [];
  private spawnTimestamps: number[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(opts: WorkerThreadsMonitorOptions = {}) {
    super();
    this.queueDepthThreshold = opts.queueDepthThreshold ?? 100;
    this.slowTaskThresholdMs = opts.slowTaskThresholdMs ?? 30_000;
    this.spawnSpikeThreshold = opts.spawnSpikeThreshold ?? 5;
    this.spawnSpikeWindowMs = opts.spawnSpikeWindowMs ?? 10_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  }

  /**
   * Activates monitoring. Hooks into worker_threads diagnostics_channel.
   */
  patch(): this {
    if (this.active) return this;
    this.active = true;

    // Attempt to hook via diagnostics_channel (Node 22+)
    try {
      const dc = getDiagnosticsChannel();
      if (!dc) throw new Error('unavailable');
      const ch = dc.channel('worker_threads.Worker.created');
      ch.subscribe(() => {
        this.activeWorkers++;
        this.spawnTimestamps.push(Date.now());
      });
    } catch {
      // diagnostics_channel not available — metrics will be zero (no worker pool detected)
    }

    // Start polling loop for anomaly detection
    this.pollTimer = setInterval(() => this._checkAnomalies(), this.pollIntervalMs);
    if (this.pollTimer.unref) this.pollTimer.unref();

    return this;
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.active = false;
  }

  /**
   * Records that a task started. Returns the start mark (performance.now() timestamp).
   */
  recordTaskStart(): number {
    this.queueDepth++;
    return performance.now();
  }

  /**
   * Records that a task completed. `startMark` is the value from `recordTaskStart()`.
   */
  recordTaskEnd(startMark: number): void {
    this.queueDepth = Math.max(0, this.queueDepth - 1);
    const duration = performance.now() - startMark;
    this.taskTimings.push(duration);
    // Keep last 100 timings
    if (this.taskTimings.length > 100) this.taskTimings.shift();

    if (duration >= this.slowTaskThresholdMs) {
      this.emit('anomaly', {
        type: 'worker-pool-anomaly',
        reason: 'slow-task',
        metrics: this.getMetrics(),
        thresholdExceeded: this.slowTaskThresholdMs,
        message: `Worker task took ${duration.toFixed(0)}ms (threshold: ${this.slowTaskThresholdMs}ms)`,
      } satisfies WorkerPoolEvent);
    }
  }

  getMetrics(): WorkerPoolMetrics {
    const avg = this.taskTimings.length > 0
      ? this.taskTimings.reduce((a, b) => a + b, 0) / this.taskTimings.length
      : 0;
    return {
      activeWorkers: this.activeWorkers,
      queueDepth: this.queueDepth,
      avgTaskDurationMs: avg,
      idleWorkers: Math.max(0, this.activeWorkers - this.queueDepth),
    };
  }

  private _checkAnomalies(): void {
    const metrics = this.getMetrics();

    if (metrics.queueDepth > this.queueDepthThreshold) {
      this.emit('anomaly', {
        type: 'worker-pool-anomaly',
        reason: 'queue-depth',
        metrics,
        thresholdExceeded: this.queueDepthThreshold,
        message: `Worker queue depth ${metrics.queueDepth} exceeds threshold ${this.queueDepthThreshold}`,
      } satisfies WorkerPoolEvent);
    }

    // Check spawn spike: count spawns in the last spawnSpikeWindowMs
    const now = Date.now();
    const windowStart = now - this.spawnSpikeWindowMs;
    this.spawnTimestamps = this.spawnTimestamps.filter(t => t >= windowStart);
    if (this.spawnTimestamps.length >= this.spawnSpikeThreshold) {
      this.emit('anomaly', {
        type: 'worker-pool-anomaly',
        reason: 'spawn-spike',
        metrics,
        thresholdExceeded: this.spawnSpikeThreshold,
        message: `${this.spawnTimestamps.length} workers spawned in ${this.spawnSpikeWindowMs}ms window`,
      } satisfies WorkerPoolEvent);
      this.spawnTimestamps = []; // reset to avoid repeated firing
    }
  }
}
