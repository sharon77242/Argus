import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

/**
 * ClickHouse client (`@clickhouse/client`) uses `ClickHouseClient.prototype`
 * methods: query, insert, exec, command.
 */
export function patchClickhouse(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const clickhouse = require('@clickhouse/client');

    // The package exports a createClient factory — we need to find the
    // prototype of the client it produces.
    const tmpClient = clickhouse.createClient?.({ url: 'http://localhost:8123' });
    if (tmpClient) {
      const clientProto = Object.getPrototypeOf(tmpClient);
      let patched = false;
      for (const method of ['query', 'insert', 'exec', 'command'] as const) {
        if (clientProto[method] && !isAlreadyPatched(clientProto, method)) {
          wrapMethod(clientProto, method, '@clickhouse/client');
          patched = true;
        }
      }
      tmpClient.close?.().catch?.(() => {});
      return patched;
    }
  } catch { /* not installed */ }
  return false;
}
