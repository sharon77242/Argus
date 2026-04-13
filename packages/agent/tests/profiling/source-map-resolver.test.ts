import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SourceMapResolver } from "../../src/profiling/source-map-resolver.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

describe("SourceMapResolver", () => {
  let resolver: SourceMapResolver;
  let tempDir: string;
  let jsFilePath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-map-test-"));
    resolver = new SourceMapResolver(tempDir);

    const tsCode = `
export function throwError() {
    const message = "Test error";
    // This is a test comment
    throw new Error(message);
}
`;

    const result = ts.transpileModule(tsCode, {
      compilerOptions: {
        sourceMap: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
      fileName: "test.ts",
    });

    jsFilePath = path.join(tempDir, "test.js");
    const mapFilePath = path.join(tempDir, "test.js.map");

    fs.writeFileSync(jsFilePath, result.outputText);

    // Align source path
    const mapObj = JSON.parse(result.sourceMapText!);
    mapObj.sources = ["test.ts"];
    fs.writeFileSync(mapFilePath, JSON.stringify(mapObj));
  });

  afterEach(() => {
    resolver.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should initialize and map generated JS back to TS source line", async () => {
    await resolver.initialize();

    const jsLines = fs.readFileSync(jsFilePath, "utf8").split("\n");

    // Find the generated 'throw new Error' line
    const throwLineIndex = jsLines.findIndex((line: string) => line.includes("throw new Error"));
    assert.ok(throwLineIndex > -1);

    const jsColumn = jsLines[throwLineIndex].indexOf("throw");

    const pos = await resolver.resolvePosition(jsFilePath, throwLineIndex + 1, jsColumn);

    assert.notStrictEqual(pos, null);
    assert.strictEqual(pos!.source, "test.ts");

    // In the original TS code, 'throw' is on line 5
    assert.strictEqual(pos!.line, 5);
  });
});
