import { EventEmitter } from "node:events";
import { type Readable } from "node:stream";
import { getDiagnosticsChannel } from "../instrumentation/safe-channel.ts";

export interface StreamLeakEvent {
  type: "stream-leak";
  aliveSinceMs: number;
  thresholdMs: number;
  stack?: string;
  message: string;
}

export interface StreamLeakDetectorOptions {
  thresholdMs?: number;
  checkIntervalMs?: number;
  captureStacks?: boolean;
}

interface TrackedStream {
  createdAt: number;
  stack?: string;
  consumed: boolean;
}

/**
 * Detects Readable streams that have been created but never consumed or destroyed.
 *
 * Primary API: call `track(stream)` for each Readable you want to monitor.
 * Optional: use `enable()` to activate diagnostics_channel hooks (Node 22+) for automatic tracking.
 *
 * Emits 'leak' when a Readable has been alive > thresholdMs without being consumed or destroyed.
 */
export class StreamLeakDetector extends EventEmitter {
  private readonly thresholdMs: number;
  private readonly checkIntervalMs: number;
  private readonly captureStacks: boolean;
  private readonly liveStreams = new WeakMap<object, TrackedStream>();
  // Strong refs required for iteration (WeakMap is not iterable)
  private readonly trackedRefs: object[] = [];
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(opts: StreamLeakDetectorOptions = {}) {
    super();
    this.thresholdMs = opts.thresholdMs ?? 30_000;
    this.checkIntervalMs = opts.checkIntervalMs ?? 5_000;
    this.captureStacks = opts.captureStacks ?? false;
  }

  /**
   * Activates stream leak detection via diagnostics_channel hooks (Node 22+).
   * Falls back gracefully when the channel is unavailable.
   */
  enable(): this {
    if (this.active) return this;
    this.active = true;

    try {
      const dc = getDiagnosticsChannel();
      if (!dc) throw new Error("unavailable");
      const createChannel = dc.channel("stream.create");
      const destroyChannel = dc.channel("stream.destroy");

      createChannel.subscribe((msg: unknown) => {
        const stream = (msg as { stream?: object }).stream;
        if (!stream) return;
        const stack = this.captureStacks ? new Error().stack : undefined;
        this.liveStreams.set(stream, { createdAt: Date.now(), stack, consumed: false });
        this.trackedRefs.push(stream);
      });

      destroyChannel.subscribe((msg: unknown) => {
        const stream = (msg as { stream?: object }).stream;
        if (stream) this.liveStreams.delete(stream);
      });
    } catch {
      // diagnostics_channel not available — rely on manual track() calls
    }

    this.checkTimer = setInterval(() => this._checkLeaks(), this.checkIntervalMs);
    if (this.checkTimer.unref) this.checkTimer.unref();

    return this;
  }

  /**
   * Deactivates stream leak detection.
   */
  disable(): void {
    if (!this.active) return;
    this.active = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Manually track a specific Readable stream.
   * Marks it consumed when 'data', 'readable', or 'end' events fire.
   * Removes it from tracking when 'close' fires.
   */
  track(stream: Readable): void {
    const stack = this.captureStacks ? new Error().stack : undefined;
    const record: TrackedStream = { createdAt: Date.now(), stack, consumed: false };
    this.liveStreams.set(stream, record);
    this.trackedRefs.push(stream);

    const markConsumed = () => {
      record.consumed = true;
    };
    stream.once("data", markConsumed);
    stream.once("readable", markConsumed);
    stream.once("end", markConsumed);
    stream.once("close", () => {
      this.liveStreams.delete(stream);
      const idx = this.trackedRefs.indexOf(stream);
      if (idx !== -1) this.trackedRefs.splice(idx, 1);
    });
    stream.once("pipe", markConsumed);
  }

  private _checkLeaks(): void {
    const now = Date.now();
    for (let i = this.trackedRefs.length - 1; i >= 0; i--) {
      const ref = this.trackedRefs[i];
      const tracked = this.liveStreams.get(ref);
      if (!tracked) {
        this.trackedRefs.splice(i, 1);
        continue;
      }
      if (tracked.consumed) continue;

      const aliveMs = now - tracked.createdAt;
      if (aliveMs >= this.thresholdMs) {
        this.emit("leak", {
          type: "stream-leak",
          aliveSinceMs: aliveMs,
          thresholdMs: this.thresholdMs,
          stack: tracked.stack,
          message: `Readable stream alive for ${aliveMs}ms without being consumed (threshold: ${this.thresholdMs}ms)`,
        } satisfies StreamLeakEvent);
        // Remove to avoid repeat-firing on same stream
        this.trackedRefs.splice(i, 1);
        this.liveStreams.delete(ref);
      }
    }
  }
}
