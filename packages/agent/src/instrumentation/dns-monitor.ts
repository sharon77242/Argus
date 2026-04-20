import dns from "node:dns";
import { EventEmitter } from "node:events";

export interface DnsEvent {
  hostname: string;
  durationMs: number;
  error?: string;
  addresses?: string[];
  timestamp: number;
}

export interface DnsMonitorOptions {
  /** Emit 'slow-dns' when a lookup exceeds this duration in ms. Default: 100. */
  slowThresholdMs?: number;
}

export class DnsMonitor extends EventEmitter {
  private active = false;
  private readonly slowThresholdMs: number;
  private _origLookup: typeof dns.lookup | null = null;

  constructor(options: DnsMonitorOptions = {}) {
    super();
    this.slowThresholdMs = options.slowThresholdMs ?? 100;
  }

  on(event: "dns", listener: (e: DnsEvent) => void): this;
  on(event: "slow-dns", listener: (e: DnsEvent) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  enable(): void {
    if (this.active) return;
    this._patchLookup();
    this.active = true;
  }

  disable(): void {
    if (!this.active) return;
    if (this._origLookup) {
      (dns as Record<string, unknown>).lookup = this._origLookup;
      this._origLookup = null;
    }
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Test helper — directly fire a DNS event without touching dns.lookup. */
  _injectDns(hostname: string, durationMs: number, error?: string, addresses?: string[]): void {
    const event: DnsEvent = { hostname, durationMs, error, addresses, timestamp: Date.now() };
    this.emit("dns", event);
    if (durationMs >= this.slowThresholdMs) {
      this.emit("slow-dns", event);
    }
  }

  private _patchLookup(): void {
    const origLookup = dns.lookup;
    this._origLookup = origLookup;

    // dns.lookup has several overloads; we intercept the callback variant only.
    (dns as Record<string, unknown>).lookup = (hostname: string, ...rest: unknown[]): void => {
      const lastArg = rest[rest.length - 1];
      if (typeof lastArg !== "function") {
        // Non-callback form (options without callback) — pass through unmodified
        (origLookup as (...a: unknown[]) => void).call(dns, hostname, ...rest);
        return;
      }

      const start = performance.now();
      const cb = lastArg as (err: Error | null, address: string, family: number) => void;
      rest[rest.length - 1] = (err: Error | null, address: string, family: number) => {
        const durationMs = performance.now() - start;
        this._injectDns(hostname, durationMs, err?.message, address ? [address] : undefined);
        cb(err, address, family);
      };

      (origLookup as (...a: unknown[]) => void).call(dns, hostname, ...rest);
    };
  }
}
