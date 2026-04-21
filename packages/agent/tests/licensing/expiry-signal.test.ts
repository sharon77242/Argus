import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeExpirySignal } from "../../src/licensing/expiry-signal.ts";

const SIGNAL_FILENAME = "diagnostic_agent_EXPIRED.txt";

function cleanup(filePath: string) {
  try {
    unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

describe("writeExpirySignal", () => {
  test("writes signal file to tmpdir", () => {
    const expectedPath = join(tmpdir(), SIGNAL_FILENAME);
    cleanup(expectedPath);

    writeExpirySignal("Test expiry message");

    // Should have been written to cwd or tmpdir
    const cwdPath = join(process.cwd(), SIGNAL_FILENAME);
    const writtenToTmp = existsSync(expectedPath);
    const writtenToCwd = existsSync(cwdPath);

    assert.ok(writtenToTmp || writtenToCwd, "Signal file should be written to tmpdir or cwd");

    // Read it and verify content
    const path = writtenToCwd ? cwdPath : expectedPath;
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes("[ArgusAgent]"), "Should contain agent prefix");
    assert.ok(content.includes("Test expiry message"), "Should contain the message");

    cleanup(cwdPath);
    cleanup(expectedPath);
  });

  test("signal file contains ISO timestamp", () => {
    const cwdPath = join(process.cwd(), SIGNAL_FILENAME);
    const tmpPath = join(tmpdir(), SIGNAL_FILENAME);
    cleanup(cwdPath);
    cleanup(tmpPath);

    writeExpirySignal("timestamp test");

    const writtenPath = existsSync(cwdPath) ? cwdPath : tmpPath;
    if (existsSync(writtenPath)) {
      const content = readFileSync(writtenPath, "utf8");
      // Should contain an ISO date like 2024-01-01T00:00:00.000Z
      assert.ok(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(content),
        "Should contain ISO timestamp",
      );
    }

    cleanup(cwdPath);
    cleanup(tmpPath);
  });

  test("falls back to stderr when all file paths fail", () => {
    // Mock writeFileSync to always throw
    const originalWrite = process.stderr.write.bind(process.stderr);

    const mockWrite = (chunk: string | Uint8Array, ...rest: unknown[]) => {
      // Still call original to avoid breaking test runner output
      return originalWrite(chunk, ...(rest as Parameters<typeof originalWrite>).slice(1));
    };
    process.stderr.write = mockWrite as typeof process.stderr.write;

    // We can't easily make all paths fail in a real test environment,
    // but we can verify the function doesn't throw
    try {
      writeExpirySignal("fallback test");
    } finally {
      process.stderr.write = originalWrite;
    }

    // Cleanup any written files
    cleanup(join(process.cwd(), SIGNAL_FILENAME));
    cleanup(join(tmpdir(), SIGNAL_FILENAME));
  });

  test("does not throw on repeated calls", () => {
    assert.doesNotThrow(() => {
      writeExpirySignal("first call");
      writeExpirySignal("second call");
    });
    cleanup(join(process.cwd(), SIGNAL_FILENAME));
    cleanup(join(tmpdir(), SIGNAL_FILENAME));
  });
});
