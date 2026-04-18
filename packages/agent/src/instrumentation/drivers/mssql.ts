import { nodeRequire } from "./_require.ts";
import { isAlreadyPatched, wrapMethod } from "./patch-utils.ts";

export function patchMssql(): boolean {
  let patched = false;

  // mssql (high-level driver)
  try {
    const mssql = nodeRequire("mssql");
    const reqProto = mssql.Request?.prototype;
    if (reqProto) {
      for (const method of ["query", "execute", "batch"] as const) {
        if (reqProto[method] && !isAlreadyPatched(reqProto, method)) {
          wrapMethod(reqProto, method, "mssql");
          patched = true;
        }
      }
    }
  } catch {
    /* not installed */
  }

  // tedious (low-level driver)
  try {
    const tedious = nodeRequire("tedious");
    const connProto = tedious.Connection?.prototype;
    if (connProto) {
      for (const method of ["execSql", "execSqlBatch"] as const) {
        if (connProto[method] && !isAlreadyPatched(connProto, method)) {
          wrapMethod(connProto, method, "tedious");
          patched = true;
        }
      }
    }
  } catch {
    /* not installed */
  }

  return patched;
}
