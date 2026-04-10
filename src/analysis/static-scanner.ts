import { exec } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { FixSuggestion, ScanResult } from './types.ts';

/**
 * Maps TypeScript diagnostic codes to severity levels.
 * Unknown codes default to 'info'.
 */
function tsSeverity(code: string): FixSuggestion['severity'] {
  // Critical: type errors that would crash at runtime
  const critical = ['2304', '2322', '2345', '2554', '2769', '7006'];
  // Warning: code quality issues
  const warning = ['6133', '6196', '2839', '7034', '7005', '2532'];
  if (critical.includes(code)) return 'critical';
  if (warning.includes(code)) return 'warning';
  return 'info';
}

/**
 * Spawns static analysis tools (TypeScript compiler, ESLint) on a target
 * directory and returns structured fix suggestions.
 */
export class StaticScanner extends EventEmitter {
  private targetDir: string;

  constructor(targetDir: string) {
    super();
    this.targetDir = targetDir;
  }

  /**
   * Run a full scan (TypeScript + ESLint if available).
   */
  public async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    const tsResult = await this.runTypeScript();
    results.push(tsResult);

    const eslintResult = await this.runEslint();
    if (eslintResult) {
      results.push(eslintResult);
    }

    this.emit('scan', results);
    return results;
  }

  /**
   * Run `tsc --noEmit` and parse diagnostics into FixSuggestions.
   */
  public async runTypeScript(): Promise<ScanResult> {
    const start = performance.now();

    return new Promise((resolve) => {
      exec(
        'npx tsc --noEmit --pretty false',
        { cwd: this.targetDir, timeout: 30_000 },
        (error, stdout, stderr) => {
          const durationMs = performance.now() - start;
          const output = (stdout || '') + (stderr || '');
          const suggestions = this.parseTypeScriptOutput(output);

          resolve({
            tool: 'tsc',
            totalIssues: suggestions.length,
            suggestions,
            durationMs,
          });
        },
      );
    });
  }

  /**
   * Run `eslint` with JSON output and parse into FixSuggestions.
   */
  public async runEslint(): Promise<ScanResult | null> {
    const start = performance.now();

    return new Promise((resolve) => {
      exec(
        'npx eslint . --format json --no-error-on-unmatched-pattern',
        { cwd: this.targetDir, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
        (error, stdout) => {
          const durationMs = performance.now() - start;

          if (!stdout || !stdout.trim().startsWith('[')) {
            // ESLint not installed or no output
            resolve(null);
            return;
          }

          try {
            const results = JSON.parse(stdout) as Array<{
              filePath: string;
              messages: Array<{
                ruleId: string | null;
                severity: number;
                message: string;
                line: number;
                column: number;
              }>;
            }>;

            const suggestions: FixSuggestion[] = [];
            for (const file of results) {
              for (const msg of file.messages) {
                suggestions.push({
                  severity: msg.severity >= 2 ? 'warning' : 'info',
                  rule: msg.ruleId || 'eslint-unknown',
                  message: msg.message,
                  location: `${file.filePath}:${msg.line}:${msg.column}`,
                });
              }
            }

            resolve({
              tool: 'eslint',
              totalIssues: suggestions.length,
              suggestions,
              durationMs,
            });
          } catch {
            resolve(null);
          }
        },
      );
    });
  }

  /**
   * Parse TypeScript compiler output into FixSuggestions.
   * Format: `filepath(line,col): error TSxxxx: message`
   */
  private parseTypeScriptOutput(output: string): FixSuggestion[] {
    const suggestions: FixSuggestion[] = [];
    const regex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/gm;

    let match;
    while ((match = regex.exec(output)) !== null) {
      const [, filePath, line, col, , code, message] = match;
      suggestions.push({
        severity: tsSeverity(code),
        rule: `TS${code}`,
        message,
        location: `${filePath}:${line}:${col}`,
      });
    }

    return suggestions;
  }
}
