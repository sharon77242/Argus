import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { FixSuggestion, ScanResult } from './types.ts';

export class AuditScanner extends EventEmitter {
  private targetDir: string;

  constructor(targetDir: string) {
    super();
    this.targetDir = targetDir;
  }

  public async scan(): Promise<ScanResult | null> {
    const start = performance.now();

    return new Promise((resolve) => {
      cp.execFile(
        'npm',
        ['audit', '--json'],
        { cwd: this.targetDir, timeout: 30_000, maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' },
        (error, stdout) => {
          const durationMs = performance.now() - start;

          if (!stdout) {
            resolve(null);
            return;
          }

          try {
            const auditData = JSON.parse(stdout) as Record<string, unknown>;
            const vulnerabilities = (auditData.vulnerabilities ?? {}) as Record<string, { severity: string }>;
            const suggestions: FixSuggestion[] = [];

            for (const pkgName of Object.keys(vulnerabilities)) {
              const vuln = vulnerabilities[pkgName];
              if (vuln.severity === 'high' || vuln.severity === 'critical') {
                suggestions.push({
                  severity: 'critical',
                  rule: `npm-audit-${vuln.severity}`,
                  message: `Dependency '${pkgName}' has a ${vuln.severity} vulnerability.`,
                  suggestedFix: `Run \`npm update ${pkgName}\` or check \`npm audit fix\` to patch this security flaw.`,
                  location: 'package.json',
                });
              }
            }

            const result: ScanResult = {
              tool: 'npm-audit',
              totalIssues: suggestions.length,
              suggestions,
              durationMs,
            };

            this.emit('scan', result);
            resolve(result);
          } catch {
            resolve(null);
          }
        },
      );
    });
  }
}
