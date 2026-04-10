import type { FixSuggestion } from './types.ts';

export class HttpAnalyzer {
  public analyze(method: string, url: string, durationMs: number, statusCode?: number): FixSuggestion[] {
    const suggestions: FixSuggestion[] = [];
    const upperMethod = method.toUpperCase();

    // 1. Server Errors Monitoring
    if (statusCode && statusCode >= 500 && statusCode < 600) {
      suggestions.push({
        severity: 'critical',
        rule: 'http-server-error',
        message: `HTTP ${upperMethod} request to ${url} failed with status ${statusCode}.`,
        suggestedFix: 'Implement exponential backoff and retry logic for this remote dependency.',
      });
    }

    // 2. Rate Limiting Monitoring
    if (statusCode === 429) {
      suggestions.push({
        severity: 'warning',
        rule: 'http-rate-limited',
        message: `HTTP ${upperMethod} request to ${url} was rate limited (429 Too Many Requests).`,
        suggestedFix: 'Throttle your outgoing requests or implement a circuit breaker circuit.',
      });
    }

    // 3. Insecure HTTP
    if (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
      suggestions.push({
        severity: 'critical',
        rule: 'insecure-http',
        message: 'Request made over unencrypted HTTP to a remote server. This risks man-in-the-middle attacks and data leaks.',
        suggestedFix: 'Switch to https:// or enforce TLS on the server side.',
      });
    }

    // 2. Missing timeout (implied if duration is extremely long without an error, though we just warn logically)
    if (durationMs > 2000) {
      suggestions.push({
        severity: 'warning',
        rule: 'slow-http-request',
        message: `HTTP ${upperMethod} request took ${durationMs.toFixed(0)}ms. Ensure you have configured proper timeouts to prevent socket hangs.`,
        suggestedFix: 'Add a timeout: `{ timeout: 3000 }` to your request options or fetch call.',
      });
    }

    // 3. GET with body warning (we'd need more data, but basic sanity check on URL is fine)
    // Here we just do basics.

    return suggestions;
  }
}
