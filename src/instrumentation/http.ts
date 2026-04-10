import diagnostics_channel from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';
import { HttpAnalyzer } from '../analysis/http-analyzer.ts';
import type { FixSuggestion } from '../analysis/types.ts';

export interface TracedHttpRequest {
  method: string;
  url: string;
  durationMs: number;
  statusCode?: number;
  error?: string;
  sourceLine?: string;
  timestamp: number;
  suggestions?: FixSuggestion[];
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
    this.channelListener = (message: any) => {
      const request = message.request;
      if (!request) return;

      const start = performance.now();
      const method = request.method || 'GET';
      const url = `${request.protocol || 'http:'}//${request.host || ''}${request.path || '/'}`;
      const sourceLine = this.getSourceLine();

      // Hook onto the request lifecycle to calculate duration
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
        };

        this.emit('request', traced);
      };

      request.once('response', (res: any) => {
        // Response started, wait for it to finish or just use response arrival as timing
        // Usually measuring time-to-first-byte (response arrival) or time-to-finish.
        // Let's use close event for total duration.
        res.once('close', () => {
          onEnd(res.statusCode);
        });
      });

      request.once('error', (err: any) => {
        onEnd(undefined, err.message);
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
