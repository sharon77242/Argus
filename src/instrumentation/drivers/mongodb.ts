import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

const MONGODB_METHODS = [
  'find', 'findOne',
  'insertOne', 'insertMany',
  'updateOne', 'updateMany',
  'deleteOne', 'deleteMany',
  'aggregate',
] as const;

export function patchMongodb(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const mongodb = require('mongodb');
    const collProto = mongodb.Collection?.prototype;
    if (!collProto) return false;

    let patched = false;
    for (const method of MONGODB_METHODS) {
      if (collProto[method] && !isAlreadyPatched(collProto, method)) {
        wrapMethod(collProto, method, 'mongodb');
        patched = true;
      }
    }
    return patched;
  } catch { /* not installed */ }
  return false;
}
