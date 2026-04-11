import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectAppTypes } from '../../src/profiling/app-type-detector.ts';

describe('App Type Detector', () => {
  it('should detect app types from this project\'s package.json', () => {
    // Our own project has no web/db/worker deps, so types should be empty
    const result = detectAppTypes(process.cwd());
    assert.ok(Array.isArray(result.types));
    assert.ok(result.matches);
    assert.ok(Array.isArray(result.matches.web));
    assert.ok(Array.isArray(result.matches.db));
    assert.ok(Array.isArray(result.matches.worker));
  });

  it('should return empty types when package.json is not found', () => {
    const result = detectAppTypes('/nonexistent/path/that/does/not/exist');
    assert.deepStrictEqual(result.types, []);
    assert.deepStrictEqual(result.matches, { web: [], db: [], worker: [] });
  });

  it('should return a valid DetectionResult shape', () => {
    const result = detectAppTypes();
    assert.ok('types' in result);
    assert.ok('matches' in result);
    assert.ok('web' in result.matches);
    assert.ok('db' in result.matches);
    assert.ok('worker' in result.matches);
  });
});
