import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

/**
 * Prisma uses `PrismaClient` with methods like `$queryRaw`, `$executeRaw`,
 * and model-level methods. We patch the raw query methods since model methods
 * are generated dynamically per-schema and harder to intercept generically.
 */
export function patchPrisma(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const prisma = require('@prisma/client');
    const proto = prisma.PrismaClient?.prototype;
    if (!proto) return false;

    let patched = false;
    for (const method of ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'] as const) {
      if (proto[method] && !isAlreadyPatched(proto, method)) {
        wrapMethod(proto, method, '@prisma/client');
        patched = true;
      }
    }
    return patched;
  } catch { /* not installed */ }
  return false;
}
