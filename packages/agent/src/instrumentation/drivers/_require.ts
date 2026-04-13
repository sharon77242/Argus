import { createRequire } from 'node:module';

// `createRequire` needs the path/URL of the current file.
// In CJS (compiled build):       `module` is the Node.js Module object, `module.filename` = __filename
// In ESM (native TS type strip): there is no `module` global — we fall back to require.main?.filename
//                                 which is fine for a dev-only type-strip context.
//
// We deliberately avoid `import.meta.url` here because this file is also compiled
// to CJS via tsc, where `import.meta` is not available.
const _base: string =
  /* CJS */  (typeof (globalThis as any).module?.filename === 'string')
    ? (globalThis as any).module.filename
  /* ESM native TS (type-strip) — process.execPath gives a valid dir for relative requires */
    : (process as any).mainModule?.filename ?? process.cwd() + '/_require.js';

const _nodeRequire: NodeRequire = createRequire(_base);

/** Mutable container for nodeRequire — allows test-time swapping. */
export const requireRef = { current: _nodeRequire };

/** Delegates to requireRef.current — swappable in tests. */
export function nodeRequire(id: string): any {
  return requireRef.current(id);
}
