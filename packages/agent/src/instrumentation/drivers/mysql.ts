import { nodeRequire } from "./_require.ts";
import { isAlreadyPatched, wrapMethod } from "./patch-utils.ts";

export function patchMysql(): boolean {
  try {
    const mysql2 = nodeRequire("mysql2");
    const proto = mysql2?.Connection?.prototype;
    let patched = false;
    if (proto?.query && !isAlreadyPatched(proto, "query")) {
      wrapMethod(proto, "query", "mysql2");
      patched = true;
    }
    if (proto?.execute && !isAlreadyPatched(proto, "execute")) {
      wrapMethod(proto, "execute", "mysql2");
      patched = true;
    }
    return patched;
  } catch {
    /* not installed */
  }
  return false;
}
