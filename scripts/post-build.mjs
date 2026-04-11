#!/usr/bin/env node
/**
 * post-build.mjs
 *
 * After `tsc -p tsconfig.cjs.json`, all files in dist/cjs/ are named `.js`
 * but the repo root has "type": "module", so Node.js would treat them as ESM
 * and break require().
 *
 * This script renames every .js → .cjs and .d.ts → .d.cts in dist/cjs/,
 * and rewrites internal require() paths to point to the renamed files.
 *
 * Run: node scripts/post-build.mjs
 */

import { readdirSync, renameSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const CJS_DIR = new URL('../dist/cjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else {
      processFile(full);
    }
  }
}

function processFile(filePath) {
  const ext = extname(filePath);

  if (ext === '.js') {
    // Rewrite internal require() calls: './foo.js' → './foo.cjs'
    let content = readFileSync(filePath, 'utf8');
    content = content.replace(
      /require\((['"])(\.\.?\/[^'"]+)\.js\1\)/g,
      (_, q, p) => `require(${q}${p}.cjs${q})`
    );
    writeFileSync(filePath, content);

    // Rename .js → .cjs
    const newPath = filePath.slice(0, -3) + '.cjs';
    renameSync(filePath, newPath);

  } else if (ext === '.ts' && filePath.endsWith('.d.ts')) {
    // Rename .d.ts → .d.cts
    const newPath = filePath.slice(0, -5) + '.d.cts'; // strip .d.ts → add .d.cts
    renameSync(filePath, newPath);

  } else if (ext === '.map') {
    // Rename source maps: .js.map → .cjs.map, .d.ts.map → .d.cts.map
    if (filePath.endsWith('.js.map')) {
      renameSync(filePath, filePath.slice(0, -7) + '.cjs.map');
    } else if (filePath.endsWith('.d.ts.map')) {
      renameSync(filePath, filePath.slice(0, -9) + '.d.cts.map');
    }
  }
}

walk(CJS_DIR);

// Patch _require.cjs to use import.meta.url-free CJS-safe implementation
// (the TS source uses __filename which is correct for CJS — nothing to patch here)

console.log('✅  CJS post-build complete: .js → .cjs, .d.ts → .d.cts');
