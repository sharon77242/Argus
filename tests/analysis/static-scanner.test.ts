import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StaticScanner } from '../../src/analysis/static-scanner.ts';

describe('StaticScanner', () => {
  it('should run TypeScript scan and return a ScanResult', async () => {
    // Scan our own project — it should pass cleanly (0 issues)
    const scanner = new StaticScanner(process.cwd());
    const result = await scanner.runTypeScript();

    assert.strictEqual(result.tool, 'tsc');
    assert.ok(typeof result.totalIssues === 'number');
    assert.ok(typeof result.durationMs === 'number');
    assert.ok(Array.isArray(result.suggestions));

    // Our project should be clean
    assert.strictEqual(result.totalIssues, 0, `Expected 0 TS issues but got ${result.totalIssues}: ${JSON.stringify(result.suggestions)}`);
  });

  it('should run full scan and emit scan event', async () => {
    const scanner = new StaticScanner(process.cwd());

    let emittedResults: any = null;
    scanner.on('scan', (results) => { emittedResults = results; });

    const results = await scanner.scan();

    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1); // At least tsc result
    assert.strictEqual(results[0].tool, 'tsc');
    assert.ok(emittedResults, 'Should have emitted scan event');
  });

  it('should parse TypeScript error output format correctly', () => {
    const scanner = new StaticScanner(process.cwd());
    const mockOutput = `src/index.ts(10,5): error TS2304: Cannot find name 'foo'.
src/index.ts(20,1): warning TS6133: 'x' is declared but never used.
src/index.ts(30,1): error TS9999: Unknown error.`;

    const suggestions = (scanner as any).parseTypeScriptOutput(mockOutput);
    
    assert.strictEqual(suggestions.length, 3);
    assert.strictEqual(suggestions[0].severity, 'critical'); // TS2304 is critical
    assert.strictEqual(suggestions[1].severity, 'warning');  // TS6133 is warning
    assert.strictEqual(suggestions[2].severity, 'info');     // TS9999 is unknown -> info
    assert.strictEqual(suggestions[0].location, 'src/index.ts:10:5');
  });

  it('should handle empty or malformed TypeScript output', () => {
    const scanner = new StaticScanner(process.cwd());
    assert.strictEqual((scanner as any).parseTypeScriptOutput('').length, 0);
    assert.strictEqual((scanner as any).parseTypeScriptOutput('random text').length, 0);
  });

  it('should handle ESLint not being installed or failing', async () => {
    const scanner = new StaticScanner('/non/existent/dir');
    const result = await scanner.runEslint();
    assert.strictEqual(result, null);
  });
});
