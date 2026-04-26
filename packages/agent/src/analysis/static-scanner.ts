import { exec } from "node:child_process";
import { EventEmitter } from "node:events";
import { dirname } from "node:path";
import type { FixSuggestion, ScanResult } from "./types.ts";

// Minimal TypeScript Compiler API surface used by this scanner.
// Defined locally so the `typescript` package resolves at runtime only (devDep),
// and type-checking passes in environments where it is not installed.
interface TsSystem {
  fileExists(path: string): boolean;
  readFile(path: string, encoding?: string): string | undefined;
}
interface TsDiagnosticMessageChain {
  messageText: string;
  next?: TsDiagnosticMessageChain[];
}
interface TsDiagnostic {
  file?: {
    fileName: string;
    getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
  };
  start?: number;
  code: number;
  messageText: string | TsDiagnosticMessageChain;
}
interface TsNode {
  kind: number;
  pos: number;
  end: number;
}
interface TsSourceFile extends TsNode {
  fileName: string;
  getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
}
interface TsProgram {
  getSyntacticDiagnostics(): readonly TsDiagnostic[];
  getSemanticDiagnostics(): readonly TsDiagnostic[];
  getSourceFiles(): readonly TsSourceFile[];
}
interface TsApi {
  sys: TsSystem;
  findConfigFile(
    searchPath: string,
    fileExists: (path: string) => boolean,
    configName?: string,
  ): string | undefined;
  readConfigFile(
    fileName: string,
    readFile: (path: string, encoding?: string) => string | undefined,
  ): { config?: unknown; error?: TsDiagnostic };
  parseJsonConfigFileContent(
    json: unknown,
    host: TsSystem,
    basePath: string,
  ): { fileNames: string[]; options: Record<string, unknown> };
  createProgram(rootNames: string[], options: Record<string, unknown>): TsProgram;
  flattenDiagnosticMessageText(
    messageText: string | TsDiagnosticMessageChain,
    newLine: string,
  ): string;
  SyntaxKind: {
    readonly NewExpression: number;
    readonly CallExpression: number;
    readonly FunctionDeclaration: number;
    readonly FunctionExpression: number;
    readonly ArrowFunction: number;
    readonly MethodDeclaration: number;
    readonly Constructor: number;
  };
  forEachChild<T>(node: TsNode, cbNode: (node: TsNode) => T | undefined): T | undefined;
}

/**
 * Maps TypeScript diagnostic codes to severity levels.
 * Unknown codes default to 'info'.
 */
function tsSeverity(code: string): FixSuggestion["severity"] {
  // Critical: type errors that would crash at runtime
  const critical = ["2304", "2322", "2345", "2554", "2769", "7006"];
  // Warning: code quality issues
  const warning = ["6133", "6196", "2839", "7034", "7005", "2532"];
  if (critical.includes(code)) return "critical";
  if (warning.includes(code)) return "warning";
  return "info";
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

  on(event: "scan", listener: (results: ScanResult[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  /**
   * Run a full scan (TypeScript + ESLint + connection-pool static rules if available).
   */
  public async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    const tsResult = await this.runTypeScript();
    results.push(tsResult);

    const eslintResult = await this.runEslint();
    if (eslintResult) {
      results.push(eslintResult);
    }

    const poolResult = await this.runConnectionPoolScan();
    if (poolResult && poolResult.totalIssues > 0) {
      results.push(poolResult);
    }

    this.emit("scan", results);
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
      // A variable is used so TypeScript does not attempt static module resolution
      // (import(literal) would error when the package is not installed).
      const tsId = "typescript";
      const tsModule: unknown = await import(tsId);
      const ts = ((tsModule as { default?: TsApi }).default ?? tsModule) as TsApi;
      return this.runTypeScriptAPI(ts, start);
    } catch {
      // typescript not resolvable — fall back to spawning tsc
      return this.runTypeScriptExec(start);
    }
  }

  private runTypeScriptAPI(ts: TsApi, start: number): ScanResult {
    const configPath = ts.findConfigFile(
      this.targetDir,
      (p: string) => (ts.sys.fileExists as (path: string) => boolean)(p),
      "tsconfig.json",
    );
    if (!configPath) {
      return {
        tool: "tsc",
        totalIssues: 0,
        suggestions: [],
        durationMs: performance.now() - start,
      };
    }

    const { config, error: readError } = ts.readConfigFile(configPath, (p: string, enc?: string) =>
      (ts.sys.readFile as (path: string, encoding?: string) => string | undefined)(p, enc),
    );
    if (readError) {
      const msg = ts.flattenDiagnosticMessageText(readError.messageText, "\n");
      return {
        tool: "tsc",
        totalIssues: 1,
        suggestions: [{ severity: "warning", rule: "tsconfig-read-error", message: msg }],
        durationMs: performance.now() - start,
      };
    }

    const parsed = ts.parseJsonConfigFileContent(config as object, ts.sys, dirname(configPath));

    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];

    const suggestions: FixSuggestion[] = diagnostics
      .filter((d) => d.file !== undefined && d.start !== undefined)
      .map((d) => {
        const { line, character } = d.file!.getLineAndCharacterOfPosition(d.start!);
        return {
          severity: tsSeverity(String(d.code)),
          rule: `TS${d.code}`,
          message: ts.flattenDiagnosticMessageText(d.messageText, " "),
          location: `${d.file!.fileName}:${line + 1}:${character + 1}`,
        };
      });

    return {
      tool: "tsc",
      totalIssues: suggestions.length,
      suggestions,
      durationMs: performance.now() - start,
    };
  }

  private async runTypeScriptExec(start: number): Promise<ScanResult> {
    return new Promise((resolve) => {
      exec(
        "npx tsc --noEmit --pretty false",
        { cwd: this.targetDir, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
        (_error, stdout, stderr) => {
          const durationMs = performance.now() - start;
          const output = (stdout || "") + (stderr || "");
          const suggestions = this.parseTypeScriptOutput(output);
          resolve({ tool: "tsc", totalIssues: suggestions.length, suggestions, durationMs });
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
        "npx eslint . --format json --no-error-on-unmatched-pattern",
        { cwd: this.targetDir, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
        (error, stdout) => {
          const durationMs = performance.now() - start;

          if (!stdout.trim().startsWith("[")) {
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
                  severity: msg.severity >= 2 ? "warning" : "info",
                  rule: msg.ruleId ?? "eslint-unknown",
                  message: msg.message,
                  location: `${file.filePath}:${msg.line}:${msg.column}`,
                });
              }
            }

            resolve({
              tool: "eslint",
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
   * R.2 — Scan TypeScript source files for connection constructors called inside
   * function bodies (missing-connection-pool). Uses the TypeScript Compiler API
   * to walk the AST; returns null if TypeScript is not available.
   */
  public async runConnectionPoolScan(): Promise<ScanResult | null> {
    const start = performance.now();

    try {
      const tsId = "typescript";
      const tsModule: unknown = await import(tsId);
      const ts = ((tsModule as { default?: TsApi }).default ?? tsModule) as TsApi;

      const configPath = ts.findConfigFile(
        this.targetDir,
        (p: string) => ts.sys.fileExists(p),
        "tsconfig.json",
      );
      if (!configPath) return null;

      const { config, error: readError } = ts.readConfigFile(
        configPath,
        (p: string, enc?: string) => ts.sys.readFile(p, enc),
      );
      if (readError) return null;

      const parsed = ts.parseJsonConfigFileContent(config as object, ts.sys, dirname(configPath));
      const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });

      const suggestions = this.detectConnectionInFunction(ts, program);

      return {
        tool: "argus-static",
        totalIssues: suggestions.length,
        suggestions,
        durationMs: performance.now() - start,
      };
    } catch {
      return null;
    }
  }

  private detectConnectionInFunction(ts: TsApi, program: TsProgram): FixSuggestion[] {
    const suggestions: FixSuggestion[] = [];

    const CONNECTION_CTORS = new Set([
      "Client",
      "Connection",
      "Sequelize",
      "MongoClient",
      "createConnection",
      "createPool",
    ]);

    const FUNCTION_KINDS = new Set([
      ts.SyntaxKind.FunctionDeclaration,
      ts.SyntaxKind.FunctionExpression,
      ts.SyntaxKind.ArrowFunction,
      ts.SyntaxKind.MethodDeclaration,
      ts.SyntaxKind.Constructor,
    ]);

    const walk = (node: TsNode, sourceFile: TsSourceFile, insideFunction: boolean): void => {
      const enterFunction = FUNCTION_KINDS.has(node.kind);
      const nowInside = insideFunction || enterFunction;
      const kindNew = ts.SyntaxKind.NewExpression;
      const kindCall = ts.SyntaxKind.CallExpression;

      if (insideFunction && (node.kind === kindNew || node.kind === kindCall)) {
        const expr = (node as { expression?: { text?: string } }).expression;
        const name = expr?.text;

        if (name && CONNECTION_CTORS.has(name)) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.pos);
          const prefix = node.kind === kindNew ? `new ${name}()` : `${name}()`;
          suggestions.push({
            severity: "warning",
            rule: "missing-connection-pool",
            message: `${prefix} called inside a function body — creates a new connection per call instead of reusing a pool.`,
            suggestedFix:
              "Move the client/pool instantiation to module scope and reuse it across requests.",
            location: `${sourceFile.fileName}:${line + 1}:${character + 1}`,
          });
        }
      }

      ts.forEachChild(node, (child) => {
        walk(child, sourceFile, nowInside);
        return undefined;
      });
    };

    for (const sourceFile of program.getSourceFiles()) {
      if (
        sourceFile.fileName.includes("node_modules") ||
        sourceFile.fileName.endsWith(".d.ts") ||
        sourceFile.fileName.endsWith(".test.ts") ||
        sourceFile.fileName.endsWith(".spec.ts")
      )
        continue;

      walk(sourceFile as TsNode, sourceFile, false);
    }

    return suggestions;
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
      const [, filePath, line, col, , code, message] = match as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
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
