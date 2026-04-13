import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  requestId: string;
  method?: string;
  url?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` inside an async context bound to `ctx`.
 * All code within the call chain (including nested async callbacks)
 * will see the same context via `getCurrentContext()`.
 */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Returns the RequestContext for the currently executing async call chain,
 * or `undefined` when called outside a `runWithContext` scope.
 */
export function getCurrentContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Creates a new RequestContext with a generated requestId and current timestamp.
 */
export function createRequestContext(method?: string, url?: string): RequestContext {
  return {
    requestId: randomUUID(),
    method,
    url,
    startedAt: Date.now(),
  };
}
