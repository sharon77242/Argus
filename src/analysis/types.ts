/**
 * A concrete suggestion to improve code quality or performance.
 * Attached to anomaly events and traced queries.
 */
export interface FixSuggestion {
  /** How urgent is this fix */
  severity: 'info' | 'warning' | 'critical';
  /** Machine-readable rule ID (e.g. 'no-select-star', 'missing-limit') */
  rule: string;
  /** Human-readable explanation of the problem */
  message: string;
  /** Optional concrete code or query rewrite */
  suggestedFix?: string;
  /** Source file and line where the issue was found (if available) */
  location?: string;
}

/**
 * Result of a static analysis scan.
 */
export interface ScanResult {
  /** Which tool produced this result ('tsc' | 'eslint') */
  tool: string;
  /** Total issues found */
  totalIssues: number;
  /** Individual suggestions */
  suggestions: FixSuggestion[];
  /** Duration of the scan in ms */
  durationMs: number;
}
