import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { getDiagnosticsChannel } from "../instrumentation/safe-channel.ts";

export interface SlowModuleRecord {
  module: string;
  durationMs: number;
}

export interface SlowRequireDetectorOptions {
  thresholdMs?: number;
}

/**
 * Measures CJS module load times at startup using diagnostics_channel 'module.cjs.load' (Node 20+).
 *
 * Limitation: Only works for CommonJS modules. ESM modules loaded via `import` are not
 * intercepted by this mechanism — this is a Node.js platform limitation (no stable
 * diagnostics_channel hook exists for ESM loaders as of Node 22).
 */
export class SlowRequireDetector extends EventEmitter {
  private readonly thresholdMs: number;
  private readonly timings = new Map<string, number>();
  private active = false;

  private subscription: ((msg: unknown) => void) | null = null;

  constructor(opts: SlowRequireDetectorOptions = {}) {
    super();
    this.thresholdMs = opts.thresholdMs ?? 100;
  }

  /**
   * Activates module load time tracking via diagnostics_channel.
   * Must be called before the modules you want to track are loaded.
   */
  patch(): this {
    if (this.active) return this;
    this.active = true;

    try {
      // 'module.cjs.load.start' / '.finish' channels ship in Node 20+ and are
      // the only supported path — Node 22 is the minimum runtime for source execution.
      const dc = getDiagnosticsChannel();
      const startTimes = new Map<string, number>();

      const beforeLoad = (msg: unknown) => {
        const { filename } = msg as { filename: string };
        if (filename) startTimes.set(filename, performance.now());
      };

      const afterLoad = (msg: unknown) => {
        const { filename } = msg as { filename: string };
        if (!filename) return;
        const start = startTimes.get(filename);
        if (start === undefined) return;
        const durationMs = performance.now() - start;
        startTimes.delete(filename);
        this.timings.set(filename, durationMs);

        if (durationMs >= this.thresholdMs) {
          this.emit("slow-require", { module: filename, durationMs });
        }
      };

      const beforeChannel = "module.cjs.load.start";
      const afterChannel = "module.cjs.load.finish";

      dc.subscribe(beforeChannel, beforeLoad);
      dc.subscribe(afterChannel, afterLoad);
      this.subscription = () => {
        dc.unsubscribe(beforeChannel, beforeLoad);
        dc.unsubscribe(afterChannel, afterLoad);
      };
    } catch {
      // diagnostics_channel not available — detector is a no-op
    }

    return this;
  }

  /**
   * Deactivates module load time tracking.
   */
  unpatch(): void {
    if (!this.active) return;
    this.active = false;
    if (this.subscription) {
      this.subscription(null);
      this.subscription = null;
    }
  }

  /**
   * Returns all recorded modules sorted by load time descending,
   * filtered to those that exceeded the threshold.
   */
  getSlowModules(): SlowModuleRecord[] {
    return [...this.timings.entries()]
      .filter(([, ms]) => ms >= this.thresholdMs)
      .map(([module, durationMs]) => ({ module, durationMs }))
      .sort((a, b) => b.durationMs - a.durationMs);
  }

  /** Returns all recorded module timings regardless of threshold. */
  getAllTimings(): SlowModuleRecord[] {
    return [...this.timings.entries()]
      .map(([module, durationMs]) => ({ module, durationMs }))
      .sort((a, b) => b.durationMs - a.durationMs);
  }
}
