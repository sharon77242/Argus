import diagnostics_channel from 'node:diagnostics_channel';

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

/**
 * Registry of active patches so we can cleanly undo them on teardown.
 */
export interface PatchRecord {
  target: any;
  methodName: string;
  original: Function;
}

export const activePatches: PatchRecord[] = [];

export const PATCHED_SYMBOL = Symbol.for('diagnostic-agent.patched');

export function isAlreadyPatched(target: any, methodName: string): boolean {
  return target[methodName]?.[PATCHED_SYMBOL] === true;
}

/**
 * Wraps a prototype method to publish query timing data to diagnostics_channel.
 * Handles three calling conventions:
 *   1. Callback-style:  client.query(sql, params, callback)
 *   2. Promise-style:   await client.query(sql, params)
 *   3. Config object:   client.query({ text: sql, values: [...] })
 */
export function wrapMethod(target: any, methodName: string, driverName: string): void {
  const original = target[methodName];
  const channel = diagnostics_channel.channel(AUTO_PATCH_CHANNEL);

  const wrapped = function (this: any, ...args: any[]) {
    const start = performance.now();

    // Extract the query string from various argument shapes
    const queryArg = args[0];
    const queryText: string =
      typeof queryArg === 'string'
        ? queryArg
        : typeof queryArg?.text === 'string'
          ? queryArg.text
          : String(queryArg ?? '');

    // Find and wrap the callback if present
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'function') {
      const originalCallback = lastArg;
      args[args.length - 1] = function (err: any, ...cbArgs: any[]) {
        const durationMs = performance.now() - start;
        channel.publish({
          query: queryText,
          durationMs,
          driver: driverName,
          error: err ?? undefined,
        } satisfies PatchedQueryMessage);
        return originalCallback.call(this, err, ...cbArgs);
      };
      return original.apply(this, args);
    }

    // Promise style
    const result = original.apply(this, args);

    if (result && typeof result.then === 'function') {
      return result.then(
        (res: any) => {
          const durationMs = performance.now() - start;
          channel.publish({
            query: queryText,
            durationMs,
            driver: driverName,
          } satisfies PatchedQueryMessage);
          return res;
        },
        (err: any) => {
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

    // Synchronous fallback
    const durationMs = performance.now() - start;
    channel.publish({
      query: queryText,
      durationMs,
      driver: driverName,
    } satisfies PatchedQueryMessage);
    return result;
  };

  (wrapped as any)[PATCHED_SYMBOL] = true;
  target[methodName] = wrapped;
  activePatches.push({ target, methodName, original });
}

/**
 * Lower-level utility: patch an arbitrary object's method.
 * Useful for users who want to patch a custom driver or library.
 */
export function patchMethod(target: any, methodName: string, driverName: string): void {
  if (isAlreadyPatched(target, methodName)) return;
  wrapMethod(target, methodName, driverName);
}
