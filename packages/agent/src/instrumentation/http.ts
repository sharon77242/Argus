import diagnostics_channel from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';
import { HttpAnalyzer } from '../analysis/http-analyzer.ts';
import type { FixSuggestion } from '../analysis/types.ts';
import { getCurrentContext } from './correlation.ts';

export interface TracedHttpRequest {
  method: string;
  url: string;
  durationMs: number;
  statusCode?: number;
  error?: string;
  sourceLine?: string;
  timestamp: number;
  suggestions?: FixSuggestion[];
  correlationId?: string;
}

export class HttpInstrumentation extends EventEmitter {
  private analyzer = new HttpAnalyzer();
  private active = false;
  private channelListener: diagnostics_channel.ChannelListener | null = null;
  private getSourceLine: () => string | undefined;

  constructor(getSourceLine: () => string | undefined) {
    super();
    this.getSourceLine = getSourceLine;
  }

  public enable(): void {
    if (this.active) return;
    
    // Subscribe natively to Node.js HTTP/HTTPS requests 
    // This avoids prototype pollution entirely.
    this.channelListener = (message: unknown) => {
      const msg = message as Record<string, unknown>;
      const request = msg.request as Record<string, unknown> | undefined;
      if (!request) return;

      const start = performance.now();
      const method = (request.method as string | undefined) ?? 'GET';
      const protocol = (request.protocol as string | undefined) ?? 'http:';
      const host = (request.host as string | undefined) ?? '';
      const path = (request.path as string | undefined) ?? '/';
      const url = `${protocol}//${host}${path}`;
      const sourceLine = this.getSourceLine();

      const correlationId = getCurrentContext()?.requestId;
      const onEnd = (statusCode?: number, errMessage?: string) => {
        const durationMs = performance.now() - start;
        const suggestions = this.analyzer.analyze(method, url, durationMs);

        const traced: TracedHttpRequest = {
          method,
          url,
          durationMs,
          statusCode,
          error: errMessage,
          sourceLine,
          timestamp: Date.now(),
          suggestions: suggestions.length > 0 ? suggestions : undefined,
          correlationId,
        };

        this.emit('request', traced);
      };

      const req = request as unknown as { once: (event: string, cb: (...a: unknown[]) => void) => void };
      req.once('response', (res: unknown) => {
        const r = res as { once: (event: string, cb: () => void) => void; statusCode?: number };
        r.once('close', () => { onEnd(r.statusCode); });
      });

      req.once('error', (err: unknown) => {
        onEnd(undefined, (err as Error).message);
      });
    };

    const channel = diagnostics_channel.channel('http.client.request.start');
    channel.subscribe(this.channelListener);
    this.active = true;
  }

  public disable(): void {
    if (!this.active || !this.channelListener) return;
    const channel = diagnostics_channel.channel('http.client.request.start');
    channel.unsubscribe(this.channelListener);
    this.active = false;
    this.channelListener = null;
  }
}
