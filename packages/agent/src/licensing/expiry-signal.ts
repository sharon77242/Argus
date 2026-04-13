import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const SIGNAL_FILENAME = 'diagnostic_agent_EXPIRED.txt';

/**
 * Writes an expiry signal file to the first writable location among:
 *   1. Current working directory
 *   2. OS temp directory
 *   3. User home directory
 *
 * Final fallback: writes to process.stderr (cannot be silenced without redirecting stderr).
 */
export function writeExpirySignal(message: string): void {
  const content = `[DiagnosticAgent] License expired — ${new Date().toISOString()}\n${message}\n`;

  const candidates = [
    join(process.cwd(), SIGNAL_FILENAME),
    join(tmpdir(), SIGNAL_FILENAME),
    join(homedir(), SIGNAL_FILENAME),
  ];

  for (const filePath of candidates) {
    try {
      writeFileSync(filePath, content, { flag: 'w' });
      return;
    } catch {
      // try next location
    }
  }

  // All file paths failed — stderr is the final fallback
  process.stderr.write(`[DiagnosticAgent] EXPIRED: ${content}`);
}
