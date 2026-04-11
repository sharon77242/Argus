/**
 * Provides a nodeRequire() function that works in both ESM and CommonJS contexts.
 *
 * - In ESM (dist/esm): createRequire(import.meta.url) is used — this is the standard approach.
 * - In CJS (dist/cjs): the native `require` function is already available on globalThis,
 *   so we use it directly. The `import.meta.url` branch is never reached.
 *
 * The CJS tsconfig suppresses the import.meta TS error via skipLibCheck + the fact that
 * globalThis.require is always truthy in CJS, so the right-hand side never executes.
 */
import { createRequire } from 'node:module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _g = globalThis as any;

// In CommonJS: globalThis.require is the real require — use it.
// In ESM:      globalThis.require is undefined — fall back to createRequire.
// The ts-ignore below suppresses the CJS-mode "import.meta not allowed" error;
// the expression is dead code in CJS because _g.require is always truthy there.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const nodeRequire: NodeRequire = _g.require ?? createRequire(import.meta.url);

export { nodeRequire };
