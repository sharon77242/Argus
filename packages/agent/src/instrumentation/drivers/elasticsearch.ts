import { nodeRequire } from "./_require.ts";
import { isAlreadyPatched, wrapMethod, serializeNoSqlQuery } from "./patch-utils.ts";

const ES_METHODS = ["search", "index", "bulk", "delete", "update", "get", "msearch"] as const;

export function patchElasticsearch(): boolean {
  try {
    const elastic = nodeRequire("@elastic/elasticsearch");
    const esProto = elastic.Client?.prototype;
    if (!esProto) return false;

    let patched = false;
    for (const method of ES_METHODS) {
      if (esProto[method] && !isAlreadyPatched(esProto, method)) {
        wrapMethod(esProto, method, "@elastic/elasticsearch", serializeNoSqlQuery);
        patched = true;
      }
    }
    return patched;
  } catch {
    /* not installed */
  }
  return false;
}
