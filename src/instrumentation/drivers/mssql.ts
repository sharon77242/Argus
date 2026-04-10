import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

export function patchMssql(): boolean {
  const require = createRequire(import.meta.url);
  let patched = false;

  // mssql (high-level driver)
  try {
    const mssql = require('mssql');
    const reqProto = mssql.Request?.prototype;
    if (reqProto) {
      for (const method of ['query', 'execute', 'batch'] as const) {
        if (reqProto[method] && !isAlreadyPatched(reqProto, method)) {
          wrapMethod(reqProto, method, 'mssql');
          patched = true;
        }
      }
    }
  } catch { /* not installed */ }

  // tedious (low-level driver)
  try {
    const tedious = require('tedious');
    const connProto = tedious.Connection?.prototype;
    if (connProto) {
      for (const method of ['execSql', 'execSqlBatch'] as const) {
        if (connProto[method] && !isAlreadyPatched(connProto, method)) {
          wrapMethod(connProto, method, 'tedious');
          patched = true;
        }
      }
    }
  } catch { /* not installed */ }

  return patched;
}
