import { nodeRequire } from "./_require.ts";
import { isAlreadyPatched, wrapMethod } from "./patch-utils.ts";

export function patchPg(): boolean {
  try {
    const pg = nodeRequire("pg");
    if (pg?.Client?.prototype?.query && !isAlreadyPatched(pg.Client.prototype, "query")) {
      wrapMethod(pg.Client.prototype, "query", "pg");
      return true;
    }
  } catch {
    /* not installed */
  }
  return false;
}
