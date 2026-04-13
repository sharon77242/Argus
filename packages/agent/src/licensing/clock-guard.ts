// Monotonic clock delta check — zero network calls, in-container only.
// Only enforced for the 'enterprise' tier; Self-Hosted Pro accepts the trade-off.
const agentStartWallMs = Date.now();
const agentStartHrns = process.hrtime.bigint();

/**
 * Detects system clock rollback by comparing wall-clock time to monotonic elapsed time.
 * Returns 'rollback' only for enterprise tier when divergence exceeds 60 seconds.
 */
export function checkClockIntegrity(tier: string, nowMs: number): 'ok' | 'rollback' {
  if (tier !== 'enterprise') return 'ok'; // Self-Hosted Pro: accepted trade-off
  const elapsedNs = process.hrtime.bigint() - agentStartHrns;
  const expectedWallMs = agentStartWallMs + Number(elapsedNs / 1_000_000n);
  if (expectedWallMs - nowMs > 60_000) return 'rollback'; // 60s NTP tolerance
  return 'ok';
}
