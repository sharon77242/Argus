/**
 * Additional coverage tests for QueryAnalyzer
 * Targets: analyzeByString (fallback), N+1 window expiry + eviction, reset(), and edge cases
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { QueryAnalyzer } from '../../src/analysis/query-analyzer.ts';

describe('QueryAnalyzer (coverage)', () => {
  let analyzer: QueryAnalyzer;

  beforeEach(() => {
    analyzer = new QueryAnalyzer();
  });

  // ── String-fallback path (analyzeByString) ─────────────────────────────────
  // The AST parser cannot parse non-SQL strings, so these trigger the catch block.

  it('should fall back to string analysis for unparseable input and detect SELECT *', () => {
    // Use a query that fails AST but matches string rules
    const q = 'SELECT * garbage that breaks ast parser &&&&';
    const s = analyzer.analyze(q);
    const star = s.find(x => x.rule === 'no-select-star');
    assert.ok(star, 'Should detect SELECT * via string fallback');
    assert.strictEqual(star!.severity, 'warning');
  });

  it('should fall back to string analysis and detect missing LIMIT', () => {
    const q = 'SELECT x garbage &&&&';
    const s = analyzer.analyze(q);
    const limit = s.find(x => x.rule === 'missing-limit');
    assert.ok(limit, 'Should detect missing LIMIT via string fallback');
  });

  it('should fall back to string analysis and detect UPDATE without WHERE', () => {
    const q = 'UPDATE foo SET col = 1 garbage &&&&';
    const s = analyzer.analyze(q);
    const rule = s.find(x => x.rule === 'missing-where-update');
    assert.ok(rule, 'Should detect UPDATE without WHERE via string fallback');
    assert.strictEqual(rule!.severity, 'critical');
  });

  it('should fall back to string analysis and detect DELETE without WHERE', () => {
    const q = 'DELETE FROM foo garbage &&&&';
    const s = analyzer.analyze(q);
    const rule = s.find(x => x.rule === 'missing-where-delete');
    assert.ok(rule, 'Should detect DELETE without WHERE via string fallback');
    assert.strictEqual(rule!.severity, 'critical');
  });

  it('should fall back to string analysis with UPDATE that HAS WHERE — no flag', () => {
    // Contrived query that fails AST but UPDATE has WHERE
    const q = 'UPDATE foo SET x = 1 WHERE id = ? garbage &&&&';
    const s = analyzer.analyze(q);
    const rule = s.find(x => x.rule === 'missing-where-update');
    assert.strictEqual(rule, undefined, 'Should not flag UPDATE WITH WHERE even in string fallback');
  });

  it('should fall back to string analysis with DELETE that HAS WHERE — no flag', () => {
    const q = 'DELETE FROM foo WHERE id = ? garbage &&&&';
    const s = analyzer.analyze(q);
    const rule = s.find(x => x.rule === 'missing-where-delete');
    assert.strictEqual(rule, undefined, 'Should not flag DELETE WITH WHERE in string fallback');
  });

  it('should fall back to string analysis with SELECT that HAS LIMIT — no limit flag', () => {
    const q = 'SELECT * garbage &&&& LIMIT 10';
    const s = analyzer.analyze(q);
    const rule = s.find(x => x.rule === 'missing-limit');
    assert.strictEqual(rule, undefined, 'Should not flag SELECT WITH LIMIT in string fallback');
  });

  // ── N+1 window expiry ─────────────────────────────────────────────────────
  it('should reset N+1 count when window expires', async () => {
    // Build an analyzer with a very short 1 ms window
    const shortAnalyzer = new (class extends QueryAnalyzer {
      constructor() {
        super();
        (this as any).N_PLUS_ONE_WINDOW_MS = 1;
      }
    })();

    const q = 'SELECT id FROM users WHERE id = ?';
    // Call 4 times
    for (let i = 0; i < 4; i++) shortAnalyzer.analyze(q);

    // Let the window expire
    await new Promise(r => setTimeout(r, 10));

    // Call again — count should reset, so no N+1 warning after just 1 more call
    const s = shortAnalyzer.analyze(q);
    const rule = s.find(x => x.rule === 'n-plus-one');
    assert.strictEqual(rule, undefined, 'N+1 count should have reset after window expiry');
  });

  // ── Eviction of stale entries (recentQueries.size > 500) ─────────────────
  it('should evict stale entries when cache exceeds 500 entries', async () => {
    const evictAnalyzer = new (class extends QueryAnalyzer {
      constructor() {
        super();
        (this as any).N_PLUS_ONE_WINDOW_MS = 1; // 1 ms window → expires instantly
      }
    })();

    // Wait to ensure timestamps are "old"
    await new Promise(r => setTimeout(r, 5));

    // Insert 501 unique queries — all with firstSeen in the "past"
    for (let i = 0; i < 501; i++) {
      evictAnalyzer.analyze(`SELECT col FROM t${i} WHERE id = ?`);
    }

    // The 502nd unique query should trigger the eviction loop
    evictAnalyzer.analyze('SELECT col FROM trigger_eviction WHERE id = ?');

    // After eviction, the internal map should have shrunk below 502
    const mapSize = (evictAnalyzer as any).recentQueries.size;
    assert.ok(mapSize < 502, `Expected eviction to reduce map size, got ${mapSize}`);
  });

  // ── reset() ──────────────────────────────────────────────────────────────
  it('reset() should clear recent query tracking so N+1 restarts', () => {
    const q = 'SELECT * FROM orders WHERE user_id = ?';
    // Reach count = 4 (one before threshold)
    for (let i = 0; i < 4; i++) analyzer.analyze(q);

    analyzer.reset();

    // Now fire 4 more — should NOT trigger N+1 because the counter was cleared
    for (let i = 0; i < 4; i++) {
      const s = analyzer.analyze(q);
      assert.ok(!s.find(x => x.rule === 'n-plus-one'), `Unexpected N+1 on call ${i + 1} after reset`);
    }
  });

  // ── analyzeSelect: SELECT with GROUP BY (no missing-limit flag) ──────────
  it('should not flag missing-limit when GROUP BY is present', () => {
    const suggestions = analyzer.analyze('SELECT status, COUNT(*) FROM orders GROUP BY status');
    const rule = suggestions.find(s => s.rule === 'missing-limit');
    assert.strictEqual(rule, undefined, 'GROUP BY exempts from missing-limit rule');
  });

  // ── Array columns with explicit star element ──────────────────────────────
  it('should detect SELECT * expressed as array column with star expr', () => {
    // node-sql-parser represents `SELECT *` with columns === '*' OR as an array
    // Both paths should produce the no-select-star suggestion
    const suggestions = analyzer.analyze('SELECT * FROM products LIMIT 20');
    const rule = suggestions.find(s => s.rule === 'no-select-star');
    assert.ok(rule, 'Should detect SELECT * via AST');
  });
});
