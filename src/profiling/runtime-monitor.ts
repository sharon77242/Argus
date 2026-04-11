import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { Session } from "node:inspector";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeHeapSnapshot } from "node:v8";

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

export class RuntimeMonitor extends EventEmitter {
  private elMonitor: IntervalHistogram;
  private intervalTimer: NodeJS.Timeout | null = null;
  private options: RuntimeMonitorOptions;

  private lastCpuProfileTime: number = 0;
  private lastMemoryUsage: number = 0;

  private inspectorSession: Session | null = null;
  private isProfiling: boolean = false;

  constructor(options: RuntimeMonitorOptions = {}) {
    super();
    this.options = {
      eventLoopThresholdMs:
        options.eventLoopThresholdMs ??
        (process.env.RUNTIME_MONITOR_EVENT_LOOP_THRESHOLD_MS
          ? parseInt(process.env.RUNTIME_MONITOR_EVENT_LOOP_THRESHOLD_MS)
          : 50),
      memoryGrowthThresholdBytes:
        options.memoryGrowthThresholdBytes ??
        (process.env.RUNTIME_MONITOR_MEMORY_GROWTH_BYTES
          ? parseInt(process.env.RUNTIME_MONITOR_MEMORY_GROWTH_BYTES)
          : 10 * 1024 * 1024),
      cpuProfileCooldownMs:
        options.cpuProfileCooldownMs ??
        (process.env.RUNTIME_MONITOR_CPU_PROFILE_COOLDOWN_MS
          ? parseInt(process.env.RUNTIME_MONITOR_CPU_PROFILE_COOLDOWN_MS)
          : 60000),
      checkIntervalMs:
        options.checkIntervalMs ??
        (process.env.RUNTIME_MONITOR_CHECK_INTERVAL_MS
          ? parseInt(process.env.RUNTIME_MONITOR_CHECK_INTERVAL_MS)
          : 1000),
      cpuProfileDurationMs:
        options.cpuProfileDurationMs ??
        (process.env.RUNTIME_MONITOR_CPU_PROFILE_DURATION_MS
          ? parseInt(process.env.RUNTIME_MONITOR_CPU_PROFILE_DURATION_MS)
          : 500),
    };

    this.elMonitor = monitorEventLoopDelay({ resolution: 10 });
    this.elMonitor.enable();
  }

  public start(): void {
    if (this.intervalTimer) return;

    this.lastMemoryUsage = process.memoryUsage().heapUsed;
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
    const currentMemory = process.memoryUsage().heapUsed;
    const growth = currentMemory - this.lastMemoryUsage;

    if (growth > this.options.memoryGrowthThresholdBytes!) {
      const snapPath = join(tmpdir(), `heap-snapshot-${Date.now()}.heapsnapshot`);
      let heapSnapshotPath: string | undefined;
      try {
        writeHeapSnapshot(snapPath);
        heapSnapshotPath = snapPath; // only set if write succeeded
      } catch (e) {
        this.emit("error", e);
      }

      this.emit("anomaly", {
        type: "memory-leak",
        growthBytes: growth,
        heapSnapshotPath,
        timestamp: Date.now(),
      } satisfies ProfilerEvent);
    }
    this.lastMemoryUsage = currentMemory; // Update baseline
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

  private captureCpuProfile(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.inspectorSession) return resolve(null);

      this.inspectorSession.post("Profiler.enable", () => {
        if (!this.inspectorSession) return resolve(null);
        this.inspectorSession.post("Profiler.start", () => {
          setTimeout(() => {
            if (!this.inspectorSession) return resolve(null);
            this.inspectorSession.post("Profiler.stop", (err, res) => {
              if (!this.inspectorSession) return resolve(null);
              this.inspectorSession.post("Profiler.disable", () => {
                if (err) resolve(null);
                else resolve(res?.profile ?? null);
              });
            });
          }, this.options.cpuProfileDurationMs);
        });
      });
    });
  }
}
