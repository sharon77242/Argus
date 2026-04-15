import { safeChannel } from '../safe-channel.ts';
import { AstSanitizer } from '../../sanitization/ast-sanitizer.ts';

const _sanitizer = new AstSanitizer();

/**
 * Serializes a NoSQL query argument (object/array) into a sanitized JSON string.
 * All leaf values are replaced with '?' so no user data reaches the channel.
 * Used by MongoDB, DynamoDB, Firestore, and Elasticsearch driver patches.
 */
export function serializeNoSqlQuery(arg: unknown): string {
  try {
    return JSON.stringify(_sanitizer.sanitizeDocument(arg));
  } catch {
    return '[nosql-query]';
  }
}

/**
 * The standard channel name that auto-patched drivers publish to.
 * The InstrumentationEngine subscribes to this by default.
 */
export const AUTO_PATCH_CHANNEL = 'db.query.execution';

/**
 * Describes the shape of a message published on the diagnostics_channel
 * by a patched driver method.
 */
export interface PatchedQueryMessage {
  query: string;
  durationMs: number;
  driver: string;
  error?: unknown;
}


type AnyTarget = any;
type AnyFn = (...args: unknown[]) => unknown;

/**
 * Registry of active patches so we can cleanly undo them on teardown.
 */
export interface PatchRecord {
  target: AnyTarget;
  methodName: string;
  original: AnyFn;
}

export const activePatches: PatchRecord[] = [];

export const PATCHED_SYMBOL = Symbol.for('diagnostic-agent.patched');

export function isAlreadyPatched(target: AnyTarget, methodName: string): boolean {
  return (target[methodName] as Record<symbol, unknown>)[PATCHED_SYMBOL] === true;
}

/**
 * Wraps a prototype method to publish query timing data to diagnostics_channel.
 * Handles three calling conventions:
 *   1. Callback-style:  client.query(sql, params, callback)
 *   2. Promise-style:   await client.query(sql, params)
 *   3. Config object:   client.query({ text: sql, values: [...] })
 *
 * @param serializeQuery  Optional serializer for the first argument.
 *   Supply `serializeNoSqlQuery` for NoSQL drivers whose queries are objects
 *   rather than strings. Defaults to SQL-style text extraction.
 */
export function wrapMethod(
  target: AnyTarget,
  methodName: string,
  driverName: string,
  serializeQuery?: (arg: unknown) => string,
): void {
  if (isAlreadyPatched(target, methodName)) return;

  const original = target[methodName] as AnyFn;
  const channel = safeChannel(AUTO_PATCH_CHANNEL);

  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const start = performance.now();

    const queryArg = args[0];
    const queryArgAsObj = queryArg as Record<string, unknown> | null;
    const queryText: string = serializeQuery
      ? serializeQuery(queryArg)
      : typeof queryArg === 'string'
        ? queryArg
        : typeof queryArgAsObj?.text === 'string'
          ? queryArgAsObj.text
          : queryArg != null ? String(queryArg as string | number) : '';

    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'function') {
      const originalCallback = lastArg as AnyFn;
      args[args.length - 1] = function (this: unknown, err: unknown, ...cbArgs: unknown[]) {
        const durationMs = performance.now() - start;
        channel.publish({
          query: queryText,
          durationMs,
          driver: driverName,
          error: err ?? undefined,
        } satisfies PatchedQueryMessage);
        return originalCallback.call(this, err, ...cbArgs) as unknown;
      };
      return original.apply(this, args) as unknown;
    }

    const result = original.apply(this, args);

    if (result && typeof result === 'object' && 'then' in result && typeof (result as Record<string, unknown>).then === 'function') {
      return (result as Promise<unknown>).then(
        (res) => {
          const durationMs = performance.now() - start;
          channel.publish({
            query: queryText,
            durationMs,
            driver: driverName,
          } satisfies PatchedQueryMessage);
          return res;
        },
        (err: unknown) => {
          const durationMs = performance.now() - start;
          channel.publish({
            query: queryText,
            durationMs,
            driver: driverName,
            error: err,
          } satisfies PatchedQueryMessage);
          throw err;
        },
      );
    }

    const durationMs = performance.now() - start;
    channel.publish({
      query: queryText,
      durationMs,
      driver: driverName,
    } satisfies PatchedQueryMessage);
    return result;
  };

  (wrapped as unknown as Record<symbol, unknown>)[PATCHED_SYMBOL] = true;
  target[methodName] = wrapped;
  activePatches.push({ target, methodName, original });
}

/**
 * Lower-level utility: patch an arbitrary object's method.
 * Useful for users who want to patch a custom driver or library.
 *
 * @param serializeQuery  Optional query serializer. Pass `serializeNoSqlQuery`
 *   for drivers whose query argument is an object rather than a string.
 */
export function patchMethod(
  target: AnyTarget,
  methodName: string,
  driverName: string,
  serializeQuery?: (arg: unknown) => string,
): void {
  if (isAlreadyPatched(target, methodName)) return;
  wrapMethod(target, methodName, driverName, serializeQuery);
}
