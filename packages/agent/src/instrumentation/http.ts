import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { HttpAnalyzer } from '../analysis/http-analyzer.ts';
import type { FixSuggestion } from '../analysis/types.ts';
import { getCurrentContext } from './correlation.ts';
import { safeChannel, supportsHttpDiagnosticsChannel } from './safe-channel.ts';

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
  private channelListener: ((msg: unknown) => void) | null = null;
  private getSourceLine: () => string | undefined;

  // Monkey-patch state — restored on disable() for Node < 18 fallback
  private _origHttpRequest: typeof http.request | null = null;
  private _origHttpsRequest: typeof https.request | null = null;

  constructor(getSourceLine: () => string | undefined) {
    super();
    this.getSourceLine = getSourceLine;
  }

  /**
   * Core tracking logic — shared by both the channel path (Node 18+) and the
   * monkey-patch fallback (Node < 18).  Attaches response/error listeners to
   * the already-created ClientRequest and emits a TracedHttpRequest when done.
   */
  private _trackClientRequest(
    req: http.ClientRequest,
    method: string,
    url: string,
    start: number,
  ): void {
    const sourceLine = this.getSourceLine();
    const correlationId = getCurrentContext()?.requestId;

    const onEnd = (statusCode?: number, errMessage?: string): void => {
      const durationMs = performance.now() - start;
      const suggestions = this.analyzer.analyze(method, url, durationMs);
      this.emit('request', {
        method,
        url,
        durationMs,
        statusCode,
        error: errMessage,
        sourceLine,
        timestamp: Date.now(),
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        correlationId,
      } satisfies TracedHttpRequest);
    };

    const reqTyped = req as unknown as {
      once: (event: string, cb: (...args: unknown[]) => void) => void;
    };

    reqTyped.once('response', (res: unknown) => {
      const r = res as {
        once: (event: string, cb: () => void) => void;
        statusCode?: number;
      };
      r.once('close', () => { onEnd(r.statusCode); });
    });
    reqTyped.once('error', (err: unknown) => {
      onEnd(undefined, (err as Error).message);
    });
  }

  public enable(): void {
    if (this.active) return;

    if (supportsHttpDiagnosticsChannel()) {
      // ── Node 18+ path: built-in HTTP diagnostics channel ──────────────────
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

        this._trackClientRequest(
          request as unknown as http.ClientRequest,
          method,
          url,
          start,
        );
      };

      safeChannel('http.client.request.start').subscribe(this.channelListener);
    } else {
      // ── Node < 18 fallback: monkey-patch http/https .request ───────────────
      this._enableMonkeyPatch();
    }

    this.active = true;
  }

  private _enableMonkeyPatch(): void {
    const self = this;

    function parseArgs(
      protocol: string,
      firstArg: string | URL | http.RequestOptions,
    ): { method: string; url: string } {
      if (typeof firstArg === 'string') {
        return { method: 'GET', url: firstArg };
      }
      if (firstArg instanceof URL) {
        return { method: 'GET', url: firstArg.toString() };
      }
      const method = (firstArg.method ?? 'GET').toUpperCase();
      const host = firstArg.hostname ?? firstArg.host ?? 'localhost';
      const port = firstArg.port != null ? `:${firstArg.port}` : '';
      const path = firstArg.path ?? '/';
      return { method, url: `${protocol}//${host}${port}${path}` };
    }

    // Patch http.request — store the original reference (no bind so restore is exact)
    const origHttp = http.request;
    this._origHttpRequest = origHttp;
    (http as Record<string, unknown>).request = function (
      ...args: Parameters<typeof http.request>
    ): http.ClientRequest {
      const req = origHttp.apply(http, args) as http.ClientRequest;
      const { method, url } = parseArgs('http:', args[0] as http.RequestOptions | string | URL);
      self._trackClientRequest(req, method, url, performance.now());
      return req;
    };

    // Patch https.request
    const origHttps = https.request;
    this._origHttpsRequest = origHttps;
    (https as Record<string, unknown>).request = function (
      ...args: Parameters<typeof https.request>
    ): http.ClientRequest {
      const req = origHttps.apply(https, args) as http.ClientRequest;
      const { method, url } = parseArgs('https:', args[0] as https.RequestOptions | string | URL);
      self._trackClientRequest(req, method, url, performance.now());
      return req;
    };
  }

  public disable(): void {
    if (!this.active) return;

    if (this.channelListener) {
      safeChannel('http.client.request.start').unsubscribe(this.channelListener);
      this.channelListener = null;
    }

    if (this._origHttpRequest) {
      (http as Record<string, unknown>).request = this._origHttpRequest;
      this._origHttpRequest = null;
    }
    if (this._origHttpsRequest) {
      (https as Record<string, unknown>).request = this._origHttpsRequest;
      this._origHttpsRequest = null;
    }

    this.active = false;
  }
}
