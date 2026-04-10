import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

export function patchMysql(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const mysql2 = require('mysql2');
    const proto = mysql2?.Connection?.prototype;
    let patched = false;
    if (proto?.query && !isAlreadyPatched(proto, 'query')) {
      wrapMethod(proto, 'query', 'mysql2');
      patched = true;
    }
    if (proto?.execute && !isAlreadyPatched(proto, 'execute')) {
      wrapMethod(proto, 'execute', 'mysql2');
      patched = true;
    }
    return patched;
  } catch { /* not installed */ }
  return false;
}
