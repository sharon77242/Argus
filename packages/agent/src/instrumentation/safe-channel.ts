/**
 * Backward-compatible diagnostics_channel helpers.
 *
 * `node:diagnostics_channel` has been present since Node 14.0.0 (experimental)
 * and became stable in Node 18.7.0. The API surface we rely on
 * (.subscribe() / .unsubscribe() at module level) is identical across
 * all versions, so a direct top-level import is safe for our minimum target of
 * Node 14.18.0. The module has never been removed or broken between versions.
 *
 * Individual channels published by Node internals have different minimums
 * (e.g. http.client.request.start ≥ 18, stream.create ≥ 22) — those are
 * handled at the call site with version checks or try/catch guards.
 *
 * NOTE: The channel-instance `.subscribe(fn)` / `.unsubscribe(fn)` signatures
 * are deprecated in Node typings (TS6387). Always use the module-level
 * `dcSubscribe` / `dcUnsubscribe` helpers exported from this file.
 */
import dc from "node:diagnostics_channel";

/**
 * Returns the diagnostics_channel module.
 * Kept as a function for API compatibility with callers that expect a nullable
 * return value, but always returns the module on our supported Node range.
 */
export function getDiagnosticsChannel(): typeof dc {
  return dc;
}

/**
 * Subscribe `listener` to the named channel using the non-deprecated
 * module-level API (`diagnostics_channel.subscribe(name, fn)`).
 */
export function dcSubscribe(name: string, listener: (msg: unknown) => void): void {
  dc.subscribe(name, listener);
}

/**
 * Unsubscribe `listener` from the named channel using the non-deprecated
 * module-level API (`diagnostics_channel.unsubscribe(name, fn)`).
 */
export function dcUnsubscribe(name: string, listener: (msg: unknown) => void): void {
  dc.unsubscribe(name, listener);
}

/**
 * Returns a diagnostics_channel Channel by name.
 * Use `dcSubscribe` / `dcUnsubscribe` for event wiring — the channel-instance
 * subscribe/unsubscribe methods are deprecated in Node typings.
 */
export function safeChannel(name: string): ReturnType<typeof dc.channel> {
  return dc.channel(name);
}

/**
 * Returns true if the built-in HTTP diagnostics channel
 * ('http.client.request.start') is published to by Node internals.
 * Node 18+ ships the undici-backed HTTP client which publishes to this channel.
 */
export function supportsHttpDiagnosticsChannel(): boolean {
  return parseInt(process.versions.node.split(".")[0], 10) >= 18;
}
