import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { validateLicense } from "../../src/licensing/license-validator.ts";
import { BUNDLED_PUBLIC_KEYS } from "../../src/licensing/public-key.ts";

// Generate a test ECDSA P-256 key pair for the tests
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
const TEST_KID = "test-k1";

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function buildJwt(
  claims: Record<string, unknown>,
  overrideHeader?: Record<string, unknown>,
  signWith: typeof privateKey | null = privateKey,
): string {
  const header = {
    alg: "ES256",
    kid: TEST_KID,
    typ: "JWT",
    ...overrideHeader,
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;

  if (signWith === null) {
    // Return with fake signature
    return `${signingInput}.fakesignature`;
  }

  const signer = createSign("SHA256");
  signer.update(signingInput);
  const sigDer = signer.sign(signWith);
  const sigB64 = base64UrlEncode(sigDer);

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

const validClaims = {
  sub: "a1b2c3d4e5f6a7b8",
  tier: "pro",
  exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  iat: Math.floor(Date.now() / 1000) - 60,
  allowedEvents: ["query", "http", "anomaly"],
  sampleRates: {},
};

describe("validateLicense", () => {
  // Install test key before tests, restore after
  test.before(() => {
    BUNDLED_PUBLIC_KEYS[TEST_KID] = publicKeyPem;
  });

  test.after(() => {
    delete BUNDLED_PUBLIC_KEYS[TEST_KID];
  });

  test("valid JWT passes and returns typed claims", () => {
    const jwt = buildJwt(validClaims);
    const claims = validateLicense(jwt);
    assert.equal(claims.tier, "pro");
    assert.equal(claims.sub, "a1b2c3d4e5f6a7b8");
    assert.deepEqual(claims.allowedEvents, ["query", "http", "anomaly"]);
    assert.deepEqual(claims.sampleRates, {});
  });

  test("expired JWT throws with message EXPIRED", () => {
    const expiredClaims = { ...validClaims, exp: Math.floor(Date.now() / 1000) - 3600 };
    const jwt = buildJwt(expiredClaims);
    assert.throws(
      () => validateLicense(jwt),
      (err: Error) => {
        assert.equal(err.message, "EXPIRED");
        return true;
      },
    );
  });

  test("tampered signature throws", () => {
    const jwt = buildJwt(validClaims);
    const parts = jwt.split(".");
    // Corrupt the signature
    parts[2] = base64UrlEncode(Buffer.from("tampered-signature-bytes"));
    assert.throws(() => validateLicense(parts.join(".")), /signature verification failed/);
  });

  test("unknown kid throws", () => {
    const jwt = buildJwt(validClaims, { kid: "unknown-key-id" });
    assert.throws(() => validateLicense(jwt), /unknown key ID/);
  });

  test("wrong algorithm throws", () => {
    const jwt = buildJwt(validClaims, { alg: "HS256" });
    assert.throws(() => validateLicense(jwt), /unsupported algorithm/);
  });

  test("algorithm none throws", () => {
    const jwt = buildJwt(validClaims, { alg: "none" });
    assert.throws(() => validateLicense(jwt), /unsupported algorithm/);
  });

  test("malformed JWT (missing dots) throws", () => {
    assert.throws(() => validateLicense("notajwtatall"), /Invalid JWT format/);
    assert.throws(() => validateLicense("only.two"), /Invalid JWT format/);
  });

  test("sub claim must be a 16-char lowercase hex string", () => {
    const jwt = buildJwt(validClaims);
    const claims = validateLicense(jwt);
    assert.match(claims.sub, /^[0-9a-f]{16}$/);
  });

  test("sub claim too short throws", () => {
    const jwt = buildJwt({ ...validClaims, sub: "abc123" });
    assert.throws(() => validateLicense(jwt), /sub claim must be a 16-character/);
  });

  test("sub claim with uppercase hex throws", () => {
    const jwt = buildJwt({ ...validClaims, sub: "A1B2C3D4E5F6A7B8" });
    assert.throws(() => validateLicense(jwt), /sub claim must be a 16-character/);
  });

  test("sampleRates is always empty object (no sampling side-effects)", () => {
    const jwt = buildJwt(validClaims);
    const claims = validateLicense(jwt);
    assert.deepEqual(claims.sampleRates, {});
    assert.equal(Object.keys(claims.sampleRates).length, 0);
  });

  test("missing kid in header throws", () => {
    const headerNoKid = base64UrlEncode(Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })));
    const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(validClaims)));
    const signingInput = `${headerNoKid}.${payloadB64}`;
    const signer = createSign("SHA256");
    signer.update(signingInput);
    const sig = base64UrlEncode(signer.sign(privateKey));
    assert.throws(() => validateLicense(`${signingInput}.${sig}`), /missing kid/);
  });
});

// ── Integration: dev-k1 key round-trip ───────────────────────────────────────
// Verifies that validateLicense() correctly resolves the 'dev-k1' key from
// BUNDLED_PUBLIC_KEYS.  We generate a fresh key pair so no fixture file is needed.
describe("dev-k1 embedded key integration", () => {
  const { privateKey: devPrivateKey, publicKey: devPublicKeyObj } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  let originalDevK1: string | undefined;

  test.before(() => {
    originalDevK1 = BUNDLED_PUBLIC_KEYS["dev-k1"];
    BUNDLED_PUBLIC_KEYS["dev-k1"] = devPublicKeyObj.export({
      type: "spki",
      format: "pem",
    }) as string;
  });

  test.after(() => {
    if (originalDevK1 !== undefined) {
      BUNDLED_PUBLIC_KEYS["dev-k1"] = originalDevK1;
    } else {
      delete BUNDLED_PUBLIC_KEYS["dev-k1"];
    }
  });

  function buildDevJwt(claims: Record<string, unknown>): string {
    const header = base64UrlEncode(
      Buffer.from(JSON.stringify({ alg: "ES256", kid: "dev-k1", typ: "JWT" })),
    );
    const payload = base64UrlEncode(Buffer.from(JSON.stringify(claims)));
    const signer = createSign("SHA256");
    signer.update(`${header}.${payload}`);
    const sig = base64UrlEncode(signer.sign(devPrivateKey));
    return `${header}.${payload}.${sig}`;
  }

  const devClaims = {
    sub: "a1b2c3d4e5f6a7b8",
    tier: "pro",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000) - 60,
    allowedEvents: ["query", "http", "anomaly"],
    sampleRates: {},
  };

  test("validates a JWT signed with the embedded dev-k1 private key", () => {
    const jwt = buildDevJwt(devClaims);
    const claims = validateLicense(jwt);
    assert.equal(claims.tier, "pro");
    assert.equal(claims.sub, "a1b2c3d4e5f6a7b8");
    assert.deepEqual(claims.allowedEvents, ["query", "http", "anomaly"]);
  });

  test("dev-k1 JWT with enterprise tier validates correctly", () => {
    const jwt = buildDevJwt({
      ...devClaims,
      tier: "enterprise",
      allowedEvents: ["query", "http", "anomaly", "fs", "log"],
    });
    const claims = validateLicense(jwt);
    assert.equal(claims.tier, "enterprise");
    assert.ok(claims.allowedEvents.includes("fs"));
  });

  test("dev-k1 JWT signed by wrong key fails signature check", () => {
    // Build a JWT with dev-k1 kid but sign with a different key
    const { privateKey: wrongKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const header = base64UrlEncode(
      Buffer.from(JSON.stringify({ alg: "ES256", kid: "dev-k1", typ: "JWT" })),
    );
    const payload = base64UrlEncode(Buffer.from(JSON.stringify(devClaims)));
    const signer = createSign("SHA256");
    signer.update(`${header}.${payload}`);
    const sig = base64UrlEncode(signer.sign(wrongKey));
    assert.throws(
      () => validateLicense(`${header}.${payload}.${sig}`),
      /signature verification failed/,
    );
  });
});

describe("shouldExport", () => {
  test("event in allowedEvents returns true", async () => {
    const { shouldExport } = await import("../../src/argus-agent.ts");
    const claims = { ...validClaims } as Parameters<typeof shouldExport>[1];
    assert.equal(shouldExport("query", claims), true);
    assert.equal(shouldExport("http", claims), true);
  });

  test("event not in allowedEvents returns false", async () => {
    const { shouldExport } = await import("../../src/argus-agent.ts");
    const claims = { ...validClaims } as Parameters<typeof shouldExport>[1];
    assert.equal(shouldExport("fs", claims), false);
    assert.equal(shouldExport("unknown-event", claims), false);
  });

  test("null claims (free mode) always returns false", async () => {
    const { shouldExport } = await import("../../src/argus-agent.ts");
    assert.equal(shouldExport("query", null), false);
    assert.equal(shouldExport("http", null), false);
  });
});
