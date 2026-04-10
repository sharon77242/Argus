import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

const ES_METHODS = ['search', 'index', 'bulk', 'delete', 'update', 'get', 'msearch'] as const;

export function patchElasticsearch(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const elastic = require('@elastic/elasticsearch');
    const esProto = elastic.Client?.prototype;
    if (!esProto) return false;

    let patched = false;
    for (const method of ES_METHODS) {
      if (esProto[method] && !isAlreadyPatched(esProto, method)) {
        wrapMethod(esProto, method, '@elastic/elasticsearch');
        patched = true;
      }
    }
    return patched;
  } catch { /* not installed */ }
  return false;
}
