/**
 * Embeds a new ECDSA P-256 public key into src/licensing/public-key.ts.
 *
 * Usage:
 *   node --experimental-strip-types scripts/embed-pubkey.ts <kid> <path/to/public.pem>
 *
 * Example:
 *   node --experimental-strip-types scripts/embed-pubkey.ts prod-k1 ./keys/prod-public.pem
 *
 * Rules:
 *   - Old keys are NEVER removed (needed to validate unexpired JWTs signed by prior keys).
 *   - The kid must be unique; the script will refuse to overwrite an existing entry.
 *   - The PEM must be SPKI format (-----BEGIN PUBLIC KEY-----).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , kid, pemPath] = process.argv;

if (!kid || !pemPath) {
  console.error('Usage: embed-pubkey.ts <kid> <path/to/public.pem>');
  process.exit(1);
}

const PUBLIC_KEY_FILE = resolve(import.meta.dirname, '../packages/agent/src/licensing/public-key.ts');

// Read and validate the PEM
const pem = readFileSync(resolve(pemPath), 'utf8').trim();
if (!pem.startsWith('-----BEGIN PUBLIC KEY-----')) {
  console.error('Error: PEM must be in SPKI format (-----BEGIN PUBLIC KEY-----)');
  process.exit(1);
}

// Read current public-key.ts
const source = readFileSync(PUBLIC_KEY_FILE, 'utf8');

// Refuse to overwrite an existing kid
if (source.includes(`'${kid}':`)) {
  console.error(`Error: kid '${kid}' already exists in BUNDLED_PUBLIC_KEYS. Choose a new kid.`);
  process.exit(1);
}

// Build the new key entry
const pemLines = pem.split('\n').map(l => l.trim()).filter(Boolean);
const entryLines = [
  `  // ── ${kid} `,
  `  '${kid}': [`,
  ...pemLines.map(l => `    '${l}',`),
  `  ].join('\\n'),`,
].join('\n');

// Inject before the closing brace of BUNDLED_PUBLIC_KEYS
const updated = source.replace(
  /^(\};)\s*$/m,
  `${entryLines}\n$1`,
);

if (updated === source) {
  console.error('Error: could not locate closing brace of BUNDLED_PUBLIC_KEYS to inject key.');
  process.exit(1);
}

writeFileSync(PUBLIC_KEY_FILE, updated, 'utf8');
console.log(`✓ Embedded public key '${kid}' into ${PUBLIC_KEY_FILE}`);
