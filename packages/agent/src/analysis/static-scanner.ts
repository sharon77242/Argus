import { exec } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { dirname } from 'node:path';
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
   * Run TypeScript diagnostics using the Compiler API (structured, no string
   * parsing). Falls back to spawning `tsc --noEmit` if `typescript` is not
   * importable in this environment.
   */
  public async runTypeScript(): Promise<ScanResult> {
    const start = performance.now();

    try {
      // Dynamic import so typescript stays a devDependency — it will be
      // available in dev/CI environments where withStaticScanner() is used.
      const tsModule = await import('typescript');
      const ts = (tsModule.default ?? tsModule) as typeof import('typescript');
      return this.runTypeScriptAPI(ts, start);
    } catch {
      // typescript not resolvable — fall back to spawning tsc
      return this.runTypeScriptExec(start);
    }
  }

  private async runTypeScriptAPI(
    ts: typeof import('typescript'),
    start: number,
  ): Promise<ScanResult> {
    const configPath = ts.findConfigFile(this.targetDir, ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) {
      return { tool: 'tsc', totalIssues: 0, suggestions: [], durationMs: performance.now() - start };
    }

    const { config, error: readError } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (readError) {
      const msg = ts.flattenDiagnosticMessageText(readError.messageText, '\n');
      return {
        tool: 'tsc',
        totalIssues: 1,
        suggestions: [{ severity: 'warning', rule: 'tsconfig-read-error', message: msg }],
        durationMs: performance.now() - start,
      };
    }

    const parsed = ts.parseJsonConfigFileContent(
      config as object,
      ts.sys,
      dirname(configPath),
    );

    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    const diagnostics = [
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ];

    const suggestions: FixSuggestion[] = diagnostics
      .filter(d => d.file !== undefined && d.start !== undefined)
      .map(d => {
        const { line, character } = d.file!.getLineAndCharacterOfPosition(d.start!);
        return {
          severity: tsSeverity(String(d.code)),
          rule: `TS${d.code}`,
          message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
          location: `${d.file!.fileName}:${line + 1}:${character + 1}`,
        };
      });

    return {
      tool: 'tsc',
      totalIssues: suggestions.length,
      suggestions,
      durationMs: performance.now() - start,
    };
  }

  private async runTypeScriptExec(start: number): Promise<ScanResult> {
    return new Promise((resolve) => {
      exec(
        'npx tsc --noEmit --pretty false',
        { cwd: this.targetDir, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
        (_error, stdout, stderr) => {
          const durationMs = performance.now() - start;
          const output = (stdout || '') + (stderr || '');
          const suggestions = this.parseTypeScriptOutput(output);
          resolve({ tool: 'tsc', totalIssues: suggestions.length, suggestions, durationMs });
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

          if (!stdout.trim().startsWith('[')) {
            // ESLint not installed or no output
            resolve(null);
            return;
          }

          try {
            const results = JSON.parse(stdout) as {
              filePath: string;
              messages: {
                ruleId: string | null;
                severity: number;
                message: string;
                line: number;
                column: number;
              }[];
            }[];

            const suggestions: FixSuggestion[] = [];
            for (const file of results) {
              for (const msg of file.messages) {
                suggestions.push({
                  severity: msg.severity >= 2 ? 'warning' : 'info',
                  rule: msg.ruleId ?? 'eslint-unknown',
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
      const [, filePath, line, col, , code, message] = match as [string, string, string, string, string, string, string];
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
