import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { Session } from "node:inspector";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getHeapSnapshot } from "node:v8";

export interface RuntimeMonitorOptions {
  eventLoopThresholdMs?: number;
  memoryGrowthThresholdBytes?: number;
  cpuProfileCooldownMs?: number;
  checkIntervalMs?: number;
  cpuProfileDurationMs?: number;
}

export interface ProfilerEvent {
  type: "event-loop-lag" | "memory-leak";
  lagMs?: number;
  growthBytes?: number;
  profileDataPath?: string; // Path to the saved CPU profile
  heapSnapshotPath?: string; // Path to the saved heap snapshot
  timestamp: number;
}

/** Parses an env-var integer and falls back to the default if the result is NaN or ≤ 0. */
function safePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class RuntimeMonitor extends EventEmitter {
  private elMonitor: IntervalHistogram;
  private intervalTimer: NodeJS.Timeout | null = null;
  private options: RuntimeMonitorOptions;

  private lastCpuProfileTime = 0;
  private lastMemoryUsage = 0;
  private baselineMemoryUsage = 0;
  private consecutiveGrowthTicks = 0;
  // Require N consecutive positive-growth ticks with total accumulated growth
  // exceeding the threshold before firing — catches both spike and slow-burn leaks.
  private static readonly GROWTH_TICKS_REQUIRED = 3;

  private inspectorSession: Session | null = null;
  private isProfiling = false;

  constructor(options: RuntimeMonitorOptions = {}) {
    super();
    this.options = {
      eventLoopThresholdMs:
        options.eventLoopThresholdMs ??
        safePositiveInt(process.env.RUNTIME_MONITOR_EVENT_LOOP_THRESHOLD_MS, 50),
      memoryGrowthThresholdBytes:
        options.memoryGrowthThresholdBytes ??
        safePositiveInt(process.env.RUNTIME_MONITOR_MEMORY_GROWTH_BYTES, 10 * 1024 * 1024),
      cpuProfileCooldownMs:
        options.cpuProfileCooldownMs ??
        safePositiveInt(process.env.RUNTIME_MONITOR_CPU_PROFILE_COOLDOWN_MS, 60000),
      checkIntervalMs:
        options.checkIntervalMs ??
        safePositiveInt(process.env.RUNTIME_MONITOR_CHECK_INTERVAL_MS, 1000),
      cpuProfileDurationMs:
        options.cpuProfileDurationMs ??
        safePositiveInt(process.env.RUNTIME_MONITOR_CPU_PROFILE_DURATION_MS, 500),
    };

    this.elMonitor = monitorEventLoopDelay({ resolution: 10 });
    this.elMonitor.enable();
  }

  public start(): void {
    if (this.intervalTimer) return;

    this.lastMemoryUsage = process.memoryUsage().heapUsed;
    this.baselineMemoryUsage = this.lastMemoryUsage;
    this.intervalTimer = setInterval(() => {
      this.checkThresholds().catch((err) => this.emit("error", err));
    }, this.options.checkIntervalMs);
    this.intervalTimer.unref(); // Don't block process exit
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.elMonitor.disable();
    if (this.inspectorSession) {
      this.inspectorSession.disconnect();
      this.inspectorSession = null;
    }
  }

  private async checkThresholds(): Promise<void> {
    const lagMs = this.elMonitor.max / 1e6; // ns to ms
    this.elMonitor.reset(); // Reset for next interval reading

    // 1. Event Loop Lag Detection
    if (lagMs > this.options.eventLoopThresholdMs!) {
      await this.handleEventLoopLag(lagMs);
    }

    // 2. Memory Growth Detection
    // Uses an accumulated-growth model to catch both sudden spikes and slow-burn leaks:
    //   - Count every tick where memory increases (growth > 0).
    //   - Fire when N consecutive growth ticks have accumulated total growth ≥ threshold.
    //   - Only reset the streak (and baseline) when memory genuinely decreases (GC ran).
    const currentMemory = process.memoryUsage().heapUsed;
    const growth = currentMemory - this.lastMemoryUsage;
    const totalGrowth = currentMemory - this.baselineMemoryUsage;

    if (growth > 0) {
      this.consecutiveGrowthTicks++;
      if (
        this.consecutiveGrowthTicks >= RuntimeMonitor.GROWTH_TICKS_REQUIRED &&
        totalGrowth > this.options.memoryGrowthThresholdBytes!
      ) {
        this.consecutiveGrowthTicks = 0;
        this.baselineMemoryUsage = currentMemory; // reset so the same leak doesn't fire repeatedly
        const snapPath = join(tmpdir(), `heap-snapshot-${Date.now()}.heapsnapshot`);
        let heapSnapshotPath: string | undefined;
        try {
          await new Promise<void>((resolve, reject) => {
            const snapshot = getHeapSnapshot();
            const file = createWriteStream(snapPath);
            snapshot.pipe(file);
            file.once('finish', resolve);
            file.once('error', reject);
            snapshot.once('error', reject);
          });
          heapSnapshotPath = snapPath;
        } catch (e) {
          this.emit("error", e);
        }

        this.emit("anomaly", {
          type: "memory-leak",
          growthBytes: totalGrowth,
          heapSnapshotPath,
          timestamp: Date.now(),
        } satisfies ProfilerEvent);
      }
    } else {
      // Memory decreased — GC cleaned up; reset streak and new baseline.
      this.consecutiveGrowthTicks = 0;
      this.baselineMemoryUsage = currentMemory;
    }
    this.lastMemoryUsage = currentMemory; // Track per-tick delta
  }

  private async handleEventLoopLag(lagMs: number): Promise<void> {
    const now = Date.now();

    if (now - this.lastCpuProfileTime < this.options.cpuProfileCooldownMs!) {
      // Fallback to simple emission if in cooldown
      this.emit("anomaly", {
        type: "event-loop-lag",
        lagMs,
        timestamp: now,
      } satisfies ProfilerEvent);
      return;
    }

    if (this.isProfiling) return;
    this.isProfiling = true;
    this.lastCpuProfileTime = now;

    try {
      if (!this.inspectorSession) {
        this.inspectorSession = new Session();
        this.inspectorSession.connect();
      }

      const profileData = await this.captureCpuProfile();
      if (!profileData) return; // Session detached or failed
      const tempPath = join(tmpdir(), `cpu-profile-${Date.now()}.cpuprofile`);
      await writeFile(tempPath, JSON.stringify(profileData), "utf-8");

      this.emit("anomaly", {
        type: "event-loop-lag",
        lagMs,
        profileDataPath: tempPath,
        timestamp: Date.now(),
      } satisfies ProfilerEvent);
    } catch (err) {
      this.emit("error", err);
    } finally {
      this.isProfiling = false;
    }
  }

  private captureCpuProfile(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.inspectorSession) return resolve(null);
      const session = this.inspectorSession;

      session.post('Profiler.enable', (enableErr) => {
        if (enableErr) return reject(enableErr);
        if (!this.inspectorSession) return resolve(null);

        session.post('Profiler.start', (startErr) => {
          if (startErr) return reject(startErr);
          if (!this.inspectorSession) return resolve(null);

          setTimeout(() => {
            if (!this.inspectorSession) return resolve(null);

            session.post('Profiler.stop', (stopErr, res) => {
              if (!this.inspectorSession) return resolve(null);

              session.post('Profiler.disable', (disableErr) => {
                if (stopErr) return reject(stopErr);
                if (disableErr) return reject(disableErr);
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                resolve(res?.profile ?? null);
              });
            });
          }, this.options.cpuProfileDurationMs);
        });
      });
    });
  }
}
