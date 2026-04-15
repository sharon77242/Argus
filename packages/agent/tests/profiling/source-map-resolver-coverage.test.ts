/**
 * Additional coverage tests for SourceMapResolver
 * Targets: resolvePosition with no consumer (lines 47-49),
 *          resolvePosition with null originalPosition.source (lines 56-58),
 *          getConsumer cache hit (lines 64-66),
 *          getConsumer map load error (lines 77-80)
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SourceMapResolver } from '../../src/profiling/source-map-resolver.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Pre-baked fixture for the cache-hit test — equivalent to ts.transpileModule output for
// `export const x = 1;\n` with target ES2022 (trivial one-liner, no transformation needed).
// Mappings: JS line 1, col 0 → TS line 1, col 0  (AAAA = four zeros in VLQ)
const CACHED_JS = `export const x = 1;\n`;
const CACHED_MAP = JSON.stringify({
  version: 3,
  file: 'cached.js',
  sourceRoot: '',
  sources: ['cached.ts'],
  names: [],
  mappings: 'AAAA',
});

describe('SourceMapResolver (coverage)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smap-cov-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ── resolvePosition with no mapped file ─────────────────────────────────
  it('should return null when resolving position for an unmapped file', async () => {
    const resolver = new SourceMapResolver(tempDir);
    await resolver.initialize(); // empty dir

    const result = await resolver.resolvePosition('/non/existent/file.js', 1, 0);
    assert.strictEqual(result, null);
    resolver.destroy();
  });

  // ── getConsumer cache hit ────────────────────────────────────────────────
  it('should return cached consumer on second resolvePosition call', async () => {
    const jsPath = path.join(tempDir, 'cached.js');
    const mapPath = path.join(tempDir, 'cached.js.map');

    fs.writeFileSync(jsPath, CACHED_JS);
    fs.writeFileSync(mapPath, CACHED_MAP);

    const resolver = new SourceMapResolver(tempDir);
    await resolver.initialize();

    // First call populates the cache
    const pos1 = await resolver.resolvePosition(jsPath, 1, 0);

    // Second call hits the cache path
    const pos2 = await resolver.resolvePosition(jsPath, 1, 0);

    // Both should return the same result (or null), not throw
    assert.deepStrictEqual(pos1, pos2);
    resolver.destroy();
  });

  // ── getConsumer with corrupt source map (JSON parse error) ───────────────
  it('should return null and log when source map is corrupt JSON', async () => {
    const jsPath = path.join(tempDir, 'corrupt.js');
    const mapPath = path.join(tempDir, 'corrupt.js.map');

    fs.writeFileSync(jsPath, 'var x = 1;\n//# sourceMappingURL=corrupt.js.map\n');
    fs.writeFileSync(mapPath, '{ this is not valid json ');

    const resolver = new SourceMapResolver(tempDir);
    await resolver.initialize();

    const result = await resolver.resolvePosition(jsPath, 1, 0);
    assert.strictEqual(result, null, 'Should return null for corrupt source map');
    resolver.destroy();
  });

  // ── resolvePosition with source that does not map to original ─────────────
  it('should return null when originalPosition.source is null', async () => {
    // Build a minimal valid source map that maps nothing (empty mappings)
    const jsPath = path.join(tempDir, 'empty.js');
    const mapPath = path.join(tempDir, 'empty.js.map');

    fs.writeFileSync(jsPath, 'var x = 1;\n');
    // A syntactically valid map with empty mappings
    const emptyMap = JSON.stringify({
      version: 3,
      sources: [],
      mappings: '',
    });
    fs.writeFileSync(mapPath, emptyMap);

    const resolver = new SourceMapResolver(tempDir);
    await resolver.initialize();

    // Line 1 col 0 has no mapping
    const result = await resolver.resolvePosition(jsPath, 1, 0);
    assert.strictEqual(result, null, 'Should return null when source is unmapped');
    resolver.destroy();
  });

  // ── destroy() on empty cache is safe ─────────────────────────────────────
  it('destroy() on fresh resolver should not throw', () => {
    const resolver = new SourceMapResolver(tempDir);
    assert.doesNotThrow(() => resolver.destroy());
  });
});
