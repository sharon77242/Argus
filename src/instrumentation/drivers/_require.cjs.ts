import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

declare const __filename: string;

export const nodeRequire: NodeRequire = createRequire(pathToFileURL(__filename).href);
