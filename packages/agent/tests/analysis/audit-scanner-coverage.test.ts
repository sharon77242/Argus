/**
 * Additional coverage tests for AuditScanner
 * Targets: no-stdout branch (resolve null), JSON parse error (resolve null)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { AuditScanner } from '../../src/analysis/audit-scanner.ts';
import type { ScanResult } from '../../src/analysis/types.ts';

describe('AuditScanner (coverage)', () => {

  it('should return null when npm audit produces no stdout', async () => {
    const scanner = new AuditScanner(process.cwd());

    // Monkey-patch cp.execFile to simulate empty stdout
    const originalExecFile = cp.execFile;
    (cp as any).execFile = (_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, '', ''); // stdout = ''
    };

    try {
      const result = await scanner.scan();
      assert.strictEqual(result, null, 'Should resolve null when stdout is empty');
    } finally {
      (cp as any).execFile = originalExecFile;
    }
  });

  it('should return null when npm audit produces invalid JSON', async () => {
    const scanner = new AuditScanner(process.cwd());

    const originalExecFile = cp.execFile;
    (cp as any).execFile = (_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, 'THIS IS NOT JSON }{{{', '');
    };

    try {
      const result = await scanner.scan();
      assert.strictEqual(result, null, 'Should resolve null on JSON parse error');
    } finally {
      (cp as any).execFile = originalExecFile;
    }
  });

  it('should emit scan event and return result when vulnerabilities are present', async () => {
    const scanner = new AuditScanner(process.cwd());

    const mockAuditOutput = JSON.stringify({
      vulnerabilities: {
        'bad-pkg': { severity: 'high' },
        'critical-pkg': { severity: 'critical' },
        'low-pkg': { severity: 'low' }, // should NOT be included
      }
    });

    const originalExecFile = cp.execFile;
    (cp as any).execFile = (_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, mockAuditOutput, '');
    };

    let emitted: ScanResult | null = null;
    scanner.on('scan', (r) => { emitted = r; });

    try {
      const result = await scanner.scan();
      assert.ok(result, 'Should return a result');
      assert.strictEqual(result!.tool, 'npm-audit');
      assert.strictEqual(result!.totalIssues, 2, 'Should only flag high/critical');
      assert.ok(emitted, 'Should have emitted scan event');
      assert.strictEqual(result!.suggestions[0].rule, 'npm-audit-high');
      assert.strictEqual(result!.suggestions[1].rule, 'npm-audit-critical');
    } finally {
      (cp as any).execFile = originalExecFile;
    }
  });
});
