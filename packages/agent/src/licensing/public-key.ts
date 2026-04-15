// Production keys are embedded by scripts/embed-pubkey.ts at publish time.
// Old keys are NEVER removed — needed to validate unexpired JWTs signed by prior keys.
// The 'kid' claim in the JWT header selects the correct key.
export const BUNDLED_PUBLIC_KEYS: Record<string, string> = {
  // ── dev key (kid: 'dev-k1') ────────────────────────────────────────────────
  // Local-development only. The matching private key is in tests/fixtures/dev-private-key.pem.
  // Replace with production keys via scripts/embed-pubkey.ts before release.
  'dev-k1': [
    '-----BEGIN PUBLIC KEY-----',
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEm6c3OOfnAWs4w3isiyB5Sm9xm1lT',
    'LKob2I5vIz9DAjA+onQtzCBhTjVwg8NZ7YWv8OA+/Twz6ll7AKAAtYx9fQ==',
    '-----END PUBLIC KEY-----',
  ].join('\n'),
};
