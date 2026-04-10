import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

/**
 * better-sqlite3 uses a synchronous API — `Database.prototype.prepare`
 * returns a `Statement` whose `.run()`, `.get()`, `.all()` execute queries.
 * We patch `Database.prototype.prepare` to wrap returned statements.
 */
export function patchBetterSqlite3(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const Database = require('better-sqlite3');
    const proto = Database?.prototype;
    if (!proto) return false;

    let patched = false;
    // Patch exec (raw SQL execution)
    if (proto.exec && !isAlreadyPatched(proto, 'exec')) {
      wrapMethod(proto, 'exec', 'better-sqlite3');
      patched = true;
    }
    // Patch prepare — the returned Statement has .run/.get/.all
    if (proto.prepare && !isAlreadyPatched(proto, 'prepare')) {
      wrapMethod(proto, 'prepare', 'better-sqlite3');
      patched = true;
    }
    return patched;
  } catch { /* not installed */ }
  return false;
}
