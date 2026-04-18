import { createVerify } from "node:crypto";
import { BUNDLED_PUBLIC_KEYS } from "./public-key.ts";

export interface LicenseClaims {
  sub: string; // opaque SHA-256 hash of userId (first 16 chars)
  tier: "self-hosted-pro" | "individual" | "pro" | "team" | "enterprise";
  exp: number; // Unix timestamp (seconds)
  iat: number; // Unix timestamp (seconds)
  allowedEvents: string[];
  sampleRates: Record<string, never>; // always {} — no sampling on any tier
}

interface JwtHeader {
  alg: string;
  kid: string;
  typ?: string;
}

function base64UrlDecode(str: string): string {
  // Convert base64url to base64
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

/**
 * Validates an Argus license JWT offline using ECDSA P-256 (ES256).
 *
 * Throws with message 'EXPIRED' if the JWT is valid but past its exp claim.
 * Throws descriptive errors for all other validation failures.
 * Never makes network calls.
 */
export function validateLicense(jwt: string): LicenseClaims {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format: expected header.payload.signature");
  }

  const [headerB64, payloadB64, sigB64] = parts;

  // 1. Decode and validate header
  let header: JwtHeader;
  try {
    header = JSON.parse(base64UrlDecode(headerB64)) as JwtHeader;
  } catch {
    throw new Error("Invalid JWT: malformed header");
  }

  if (header.alg !== "ES256") {
    throw new Error(`Invalid JWT: unsupported algorithm '${header.alg}' — only ES256 is accepted`);
  }

  if (!header.kid) {
    throw new Error("Invalid JWT: missing kid in header");
  }

  // 2. Look up the public key by key ID
  const publicKeyPem = BUNDLED_PUBLIC_KEYS[header.kid];
  if (!publicKeyPem) {
    throw new Error(`Invalid JWT: unknown key ID '${header.kid}'`);
  }

  // 3. Verify ECDSA signature over "header.payload"
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(
    sigB64
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(sigB64.length + ((4 - (sigB64.length % 4)) % 4), "="),
    "base64",
  );

  const verifier = createVerify("SHA256");
  verifier.update(signingInput);
  const valid = verifier.verify(publicKeyPem, signature);

  if (!valid) {
    throw new Error("Invalid JWT: signature verification failed");
  }

  // 4. Decode and validate payload
  let claims: LicenseClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadB64)) as LicenseClaims;
  } catch {
    throw new Error("Invalid JWT: malformed payload");
  }

  // 5. Check expiry (after signature verify to avoid timing leaks)
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSeconds) {
    throw new Error("EXPIRED");
  }

  // 6. Validate sub is a 16-char lowercase hex string (first 16 chars of SHA-256 user hash)
  if (!claims.sub || !/^[0-9a-f]{16}$/.test(claims.sub)) {
    throw new Error("Invalid JWT: sub claim must be a 16-character lowercase hex string");
  }

  return claims;
}
