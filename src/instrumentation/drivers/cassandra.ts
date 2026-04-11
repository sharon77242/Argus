import { nodeRequire } from './_require.ts';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

/**
 * Apache Cassandra (`cassandra-driver`) uses `Client.prototype.execute`
 * and `Client.prototype.batch` for query execution.
 */
export function patchCassandra(): boolean {
  try {
    const cassandra = nodeRequire('cassandra-driver');
    const proto = cassandra.Client?.prototype;
    if (!proto) return false;

    let patched = false;
    for (const method of ['execute', 'batch', 'eachRow'] as const) {
      if (proto[method] && !isAlreadyPatched(proto, method)) {
        wrapMethod(proto, method, 'cassandra-driver');
        patched = true;
      }
    }
    return patched;
  } catch { /* not installed */ }
  return false;
}
