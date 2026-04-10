import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

export function patchPg(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const pg = require('pg');
    if (pg?.Client?.prototype?.query && !isAlreadyPatched(pg.Client.prototype, 'query')) {
      wrapMethod(pg.Client.prototype, 'query', 'pg');
      return true;
    }
  } catch { /* not installed */ }
  return false;
}
