import { createRequire } from "node:module";

// `createRequire` needs the path/URL of the current file.
// In CJS (compiled build):       `module` is the Node.js Module object, `module.filename` = __filename
// In ESM (native TS type strip): there is no `module` global — we fall back to require.main?.filename
//                                 which is fine for a dev-only type-strip context.
//
// We deliberately avoid `import.meta.url` here because this file is also compiled
// to CJS via tsc, where `import.meta` is not available.
// Access CJS `module.filename` (not in TS global types) and deprecated `process.mainModule`.
const _globalRecord = globalThis as Record<string, unknown>;
const _cjsMod = _globalRecord.module;
const _cjsFilename =
  typeof _cjsMod === "object" && _cjsMod !== null
    ? ((_cjsMod as Record<string, unknown>).filename as string | undefined)
    : undefined;
const _legacyMain = (process as unknown as { mainModule?: { filename?: string } }).mainModule;
const _base: string = _cjsFilename ?? _legacyMain?.filename ?? `${process.cwd()}/_require.js`;

const _nodeRequire: NodeRequire = createRequire(_base);

/** Mutable container for nodeRequire — allows test-time swapping. */
export const requireRef = { current: _nodeRequire };

/** Delegates to requireRef.current — swappable in tests. */
export function nodeRequire(id: string): any {
  return requireRef.current(id);
}
