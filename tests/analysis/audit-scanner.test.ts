import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AuditScanner } from '../../src/analysis/audit-scanner.ts';
import child_process from 'node:child_process';

describe('AuditScanner', () => {
  it('should parse npm audit output and flag high/critical vulnerabilities', async () => {
    // Mock the execFile callback to simulate a vulnerable package
    const mockOutput = JSON.stringify({
      vulnerabilities: {
        'dummy-pkg': {
          severity: 'critical',
          name: 'dummy-pkg',
        },
        'minor-pkg': {
          severity: 'low',
          name: 'minor-pkg'
        }
      }
    });

    mock.method(child_process, 'execFile', (cmd: any, args: any, opts: any, cb: Function) => {
      cb(null, mockOutput);
      return {};
    });

    const scanner = new AuditScanner(process.cwd());
    const result = await scanner.scan();

    assert.ok(result);
    assert.strictEqual(result.tool, 'npm-audit');
    assert.strictEqual(result.totalIssues, 1);
    assert.strictEqual(result.suggestions[0].severity, 'critical');
    assert.ok(result.suggestions[0].message.includes('dummy-pkg'));

    mock.restoreAll();
  });
});
