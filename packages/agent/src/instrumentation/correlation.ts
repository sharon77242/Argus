import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, randomBytes } from "node:crypto";

export interface RequestContext {
  /** Service-internal request identifier (UUID). */
  requestId: string;
  /** W3C TraceContext trace-id — 128-bit, 32 lowercase hex chars. Propagated across services. */
  traceId: string;
  /** W3C TraceContext span-id for this service hop — 64-bit, 16 lowercase hex chars. */
  spanId: string;
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
 * Parse a W3C `traceparent` header value.
 * Returns `{ traceId, spanId }` on success, or `null` if the header is absent or malformed.
 * Only version `00` is accepted per the spec.
 */
export function parseTraceparent(
  header: string | string[] | undefined,
): { traceId: string; spanId: string } | null {
  const h = Array.isArray(header) ? header[0] : header;
  if (!h) return null;
  const parts = h.split("-");
  if (parts.length !== 4 || parts[0] !== "00") return null;
  const [, traceId, spanId] = parts;
  if (traceId.length !== 32 || spanId.length !== 16) return null;
  if (!/^[0-9a-f]+$/i.test(traceId) || !/^[0-9a-f]+$/i.test(spanId)) return null;
  return { traceId, spanId };
}

/**
 * Serialize a traceId + spanId into a W3C `traceparent` header value.
 * The sampled flag (`01`) is always set.
 */
export function makeTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

/**
 * Creates a new RequestContext.
 *
 * When `traceparent` is supplied (e.g. from an incoming HTTP request header),
 * the existing `traceId` is inherited so distributed traces stay correlated.
 * A fresh `spanId` is always generated for this service hop.
 *
 * @param method      HTTP method (optional)
 * @param url         Request URL (optional)
 * @param traceparent Incoming W3C traceparent header value (optional)
 */
export function createRequestContext(
  method?: string,
  url?: string,
  traceparent?: string | string[],
): RequestContext {
  const parsed = parseTraceparent(traceparent);
  return {
    requestId: randomUUID(),
    traceId: parsed?.traceId ?? randomBytes(16).toString("hex"),
    spanId: randomBytes(8).toString("hex"),
    method,
    url,
    startedAt: Date.now(),
  };
}
