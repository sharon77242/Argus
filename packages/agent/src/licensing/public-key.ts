// Production keys are embedded by scripts/embed-pubkey.ts at publish time.
// Old keys are NEVER removed — needed to validate unexpired JWTs signed by prior keys.
// The 'kid' claim in the JWT header selects the correct key.
export const BUNDLED_PUBLIC_KEYS: Record<string, string> = {
  // ── dev key (kid: 'dev-k1') ────────────────────────────────────────────────
  // Local-development only. Tests override this key dynamically via generateKeyPairSync.
  // Replace with production keys via scripts/embed-pubkey.ts before release.
  "dev-k1": [
    "-----BEGIN PUBLIC KEY-----",
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEigsqIaC12FuQVm/cJsoJxQIxbp2x",
    "QsctzQjdtv6/QpCfyom5+rr/LhDHYC2ZassiTkrVpcaP4PN70JDYkHDptg==",
    "-----END PUBLIC KEY-----",
  ].join("\n"),
};
