import { nodeRequire } from './_require.ts';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

/**
 * Google Cloud Firestore patches:
 * - `CollectionReference.prototype` methods (add, get, doc)
 * - `DocumentReference.prototype` methods (get, set, update, delete)
 * - `Query.prototype.get` for query execution
 */
export function patchFirestore(): boolean {
  try {
    const firestore = nodeRequire('@google-cloud/firestore');
    let patched = false;

    // Firestore instance-level
    const fsProto = firestore.Firestore?.prototype;
    if (fsProto) {
      for (const method of ['getAll', 'runTransaction'] as const) {
        if (fsProto[method] && !isAlreadyPatched(fsProto, method)) {
          wrapMethod(fsProto, method, '@google-cloud/firestore');
          patched = true;
        }
      }
    }

    // CollectionReference
    const collProto = firestore.CollectionReference?.prototype;
    if (collProto) {
      for (const method of ['add', 'get'] as const) {
        if (collProto[method] && !isAlreadyPatched(collProto, method)) {
          wrapMethod(collProto, method, '@google-cloud/firestore');
          patched = true;
        }
      }
    }

    // DocumentReference
    const docProto = firestore.DocumentReference?.prototype;
    if (docProto) {
      for (const method of ['get', 'set', 'update', 'delete', 'create'] as const) {
        if (docProto[method] && !isAlreadyPatched(docProto, method)) {
          wrapMethod(docProto, method, '@google-cloud/firestore');
          patched = true;
        }
      }
    }

    return patched;
  } catch { /* not installed */ }
  return false;
}
