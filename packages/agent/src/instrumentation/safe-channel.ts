/**
 * Backward-compatible diagnostics_channel helpers.
 *
 * `node:diagnostics_channel` has been present since Node 14.0.0 (experimental)
 * and became stable in Node 18.7.0. The API surface we rely on
 * (.channel() / .subscribe() / .publish() / .unsubscribe()) is identical across
 * all versions, so a direct top-level import is safe for our minimum target of
 * Node 14.18.0. The module has never been removed or broken between versions.
 *
 * Individual channels published by Node internals have different minimums
 * (e.g. http.client.request.start ≥ 18, stream.create ≥ 22) — those are
 * handled at the call site with version checks or try/catch guards.
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
 * Returns a diagnostics_channel Channel by name.
 * Named `safeChannel` for historical reasons (previously included a null-guard
 * when the module could be absent; now always resolves on Node ≥ 14.18.0).
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
