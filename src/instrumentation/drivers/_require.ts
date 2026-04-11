import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// __filename is injected by Node's CJS module wrapper.
// For ESM consumers, post-build.esm.mjs patches this file to use import.meta.url.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
declare const __filename: string;

export const nodeRequire: NodeRequire = createRequire(pathToFileURL(__filename).href);
