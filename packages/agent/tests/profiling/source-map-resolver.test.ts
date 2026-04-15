import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SourceMapResolver } from "../../src/profiling/source-map-resolver.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Pre-baked fixture — equivalent to `ts.transpileModule` output for:
//   export function throwError() {
//       const message = "Test error";
//       // This is a test comment
//       throw new Error(message);
//   }
// (with a leading blank line, matching the original template-literal tsCode)
//
// VLQ mappings explanation (each segment: genCol, srcIdx, srcLine, srcCol — all relative):
//   JS line 1 → TS 0-idx 1 (1-idx 2), col 7  : AACO
//   JS line 2 → TS 0-idx 2 (1-idx 3), col 4  : IACH
//   JS line 3 → TS 0-idx 3 (1-idx 4), col 4  : IACA
//   JS line 4 → TS 0-idx 4 (1-idx 5), col 4  : IACA  ← "throw new Error" maps here
//   JS line 5 → TS 0-idx 5 (1-idx 6), col 0  : AACJ
const JS_FIXTURE = `function throwError() {
    const message = "Test error";
    // This is a test comment
    throw new Error(message);
}
`;

const MAP_FIXTURE = JSON.stringify({
  version: 3,
  file: "test.js",
  sourceRoot: "",
  sources: ["test.ts"],
  names: [],
  mappings: "AACO;IACH;IACA;IACA;AACJ",
});

describe("SourceMapResolver", () => {
  let resolver: SourceMapResolver;
  let tempDir: string;
  let jsFilePath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-map-test-"));
    resolver = new SourceMapResolver(tempDir);

    jsFilePath = path.join(tempDir, "test.js");
    const mapFilePath = path.join(tempDir, "test.js.map");

    fs.writeFileSync(jsFilePath, JS_FIXTURE);
    fs.writeFileSync(mapFilePath, MAP_FIXTURE);
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
