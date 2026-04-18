import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { DiagnosticAgent } from "../src/diagnostic-agent.ts";
import { BUNDLED_PUBLIC_KEYS } from "../src/licensing/public-key.ts";

// ── Helpers for JWT generation in tests ──────────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const TEST_KID = "test-diag-k1";
BUNDLED_PUBLIC_KEYS[TEST_KID] = publicKey.export({ type: "spki", format: "pem" }) as string;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function buildJwt(claims: Record<string, unknown>): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: TEST_KID, typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const sig = b64url(signer.sign(privateKey));
  return `${header}.${payload}.${sig}`;
}

const BASE_CLAIMS = {
  sub: "a1b2c3d4e5f6a7b8",
  tier: "pro",
  iat: Math.floor(Date.now() / 1000) - 60,
  allowedEvents: ["query", "http", "anomaly"],
  sampleRates: {},
};

describe("DiagnosticAgent (builder pattern)", () => {
  let agent: DiagnosticAgent | null = null;

  afterEach(async () => {
    await agent?.stop();
    agent = null;
    delete process.env.DIAGNOSTIC_LICENSE_KEY;
  });

  it("should start and stop with minimal configuration", async () => {
    agent = await DiagnosticAgent.create().start();

    assert.strictEqual(agent.isRunning, true);
    await agent.stop();
    assert.strictEqual(agent.isRunning, false);
  });

  it("should accept chained configuration without errors", async () => {
    agent = await DiagnosticAgent.create()
      .withRuntimeMonitor({ checkIntervalMs: 200, eventLoopThresholdMs: 100 })
      .withInstrumentation()
      .withAggregatorWindow(5000)
      .withEntropyThreshold(3.5);

    // Not started yet — just configured
    assert.strictEqual(agent.isRunning, false);

    await agent.start();
    assert.strictEqual(agent.isRunning, true);
  });

  it("should throw when calling traceQuery without instrumentation", async () => {
    agent = await DiagnosticAgent.create().start();

    await assert.rejects(() => agent!.traceQuery("SELECT 1", async () => "ok"), {
      message: /Instrumentation is not enabled/,
    });
  });

  it("should throw when calling resolvePosition without source maps", async () => {
    agent = await DiagnosticAgent.create().start();

    await assert.rejects(() => agent!.resolvePosition("foo.js", 1, 0), {
      message: /Source maps are not enabled/,
    });
  });

  it("should allow traceQuery when instrumentation is enabled", async () => {
    agent = await DiagnosticAgent.create().withInstrumentation().withAggregatorWindow(100);

    await agent.start();

    const result = await agent.traceQuery("SELECT * FROM users WHERE id = 5", async () => ({
      rows: [],
    }));

    assert.deepStrictEqual(result, { rows: [] });
  });

  it("should be idempotent on double start / double stop", async () => {
    agent = await DiagnosticAgent.create().withRuntimeMonitor({ checkIntervalMs: 500 });

    await agent.start();
    await agent.start(); // second start is a no-op

    assert.strictEqual(agent.isRunning, true);

    await agent.stop();
    await agent.stop(); // second stop is a no-op

    assert.strictEqual(agent.isRunning, false);
  });

  // ── New Phase 0 tests ──────────────────────────────────────────────────────

  it(".withGracefulShutdown() builder method exists and returns this for chaining", () => {
    const a = DiagnosticAgent.create();
    const result = a.withGracefulShutdown();
    assert.strictEqual(result, a, ".withGracefulShutdown() should return this for chaining");
    result.withGracefulShutdown({ timeoutMs: 3000 }); // accepts options
  });

  it("valid DIAGNOSTIC_LICENSE_KEY emits info with tier and exp", async () => {
    const jwt = buildJwt({
      ...BASE_CLAIMS,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    process.env.DIAGNOSTIC_LICENSE_KEY = jwt;

    const messages: string[] = [];
    agent = DiagnosticAgent.create();
    agent.on("info", (m: string) => messages.push(m));
    await agent.start();

    assert.ok(
      messages.some((m) => m.includes("tier=pro")),
      `Expected info with tier=pro, got: ${JSON.stringify(messages)}`,
    );
  });

  it("expired DIAGNOSTIC_LICENSE_KEY emits info about expiry without crashing", async () => {
    const jwt = buildJwt({
      ...BASE_CLAIMS,
      exp: Math.floor(Date.now() / 1000) - 3600, // already expired
    });
    process.env.DIAGNOSTIC_LICENSE_KEY = jwt;

    const messages: string[] = [];
    agent = DiagnosticAgent.create();
    agent.on("info", (m: string) => messages.push(m));

    // Must not throw
    await assert.doesNotReject(() => agent!.start());
    assert.ok(
      messages.some((m) => m.toLowerCase().includes("expired")),
      `Expected expiry info message, got: ${JSON.stringify(messages)}`,
    );
    assert.strictEqual(agent.isRunning, true, "Agent should still be running in free mode");
  });

  it("invalid DIAGNOSTIC_LICENSE_KEY emits error without crashing", async () => {
    process.env.DIAGNOSTIC_LICENSE_KEY = "not.a.valid.jwt.atall";

    const errors: unknown[] = [];
    agent = DiagnosticAgent.create();
    agent.on("error", (e: unknown) => errors.push(e));

    // Must not throw
    await assert.doesNotReject(() => agent!.start());
    assert.ok(errors.length > 0, "Should emit error for invalid license key");
    assert.strictEqual(agent.isRunning, true, "Agent should still be running in free mode");
  });
});
