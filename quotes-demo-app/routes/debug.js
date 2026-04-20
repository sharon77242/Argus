'use strict';

/**
 * Debug routes — intentionally trigger every DiagnosticAgent monitoring feature.
 * Never use patterns like these in production code.
 */

const express = require('express');
const router = express.Router();
const db = require('../services/db');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DEMO_FILE = path.join(__dirname, '../package.json');

// ── Query hints ────────────────────────────────────────────────────────────────

// Triggers: no-select-star + missing-limit + full-table-scan
router.get('/select-star', async (_req, res) => {
  try {
    const rows = await db.query('SELECT * FROM quote');
    res.json({ count: rows.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Triggers: missing-where-update (critical — updates every row)
router.post('/update-all', async (_req, res) => {
  try {
    await db.query('UPDATE quote SET updated_at = NOW()');
    res.json({ updated: 'all rows' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── FS hints ───────────────────────────────────────────────────────────────────

// Triggers: synchronous-fs (every call) + missing-fs-cache (5th call)
router.get('/sync-read', (_req, res) => {
  const content = fs.readFileSync(DEMO_FILE, 'utf8');
  res.json({ bytes: content.length });
});

// ── Log hints (run inside the server process so agent intercepts them) ─────────

// Triggers: unstructured-log
router.get('/log-unstructured', (_req, res) => {
  console.log('User action recorded', { userId: 42, route: '/quotes', method: 'GET' });
  res.json({ ok: true });
});

// Triggers: large-log-payload
router.get('/log-large', (_req, res) => {
  const bulk = Array.from({ length: 600 }, (_, i) => ({ id: i, quote: 'placeholder text here', author: 'author' }));
  console.log('Bulk export:', JSON.stringify(bulk));
  res.json({ ok: true });
});

// Triggers: log-error-storm (fires on 5th console.error within 1 s)
router.get('/log-storm', (_req, res) => {
  for (let i = 0; i < 6; i++) console.error('DB connection timeout on replica host');
  res.json({ ok: true });
});

// ── SCRUB ──────────────────────────────────────────────────────────────────────

// Triggers: high-entropy secret detection + redaction
router.get('/scrub', (_req, res) => {
  console.log('DB connect string: postgres://user:aB3xK9mZqR7vL2nY5pW8dC1eT4uO6i@localhost/quotesdb');
  res.json({ ok: true });
});

// ── Event-loop anomaly ─────────────────────────────────────────────────────────

// Triggers: ANOM event-loop-lag (blocks for 120 ms)
router.get('/busy-spin', (_req, res) => {
  const start = Date.now();
  while (Date.now() - start < 120) { /* intentional busy-spin */ }
  res.json({ ok: true });
});

// ── FS security hints ─────────────────────────────────────────────────────────

// Triggers: path-traversal-risk (raw '../' in path argument)
router.get('/path-traversal', (_req, res) => {
  try { fs.readFileSync('../package.json', 'utf8'); } catch { /* path may not resolve */ }
  res.json({ ok: true });
});

// Triggers: sensitive-file-access (path ends with '.env')
router.get('/sensitive-file', (_req, res) => {
  try { fs.readFileSync(path.join(__dirname, '../.env'), 'utf8'); } catch { /* file may not exist */ }
  res.json({ ok: true });
});

// ── Memory anomaly ─────────────────────────────────────────────────────────────

// Triggers: memory-leak anomaly (grows V8 heap >10 MB; RuntimeMonitor detects on next tick)
// Buffer.alloc uses off-heap memory — must use JS objects to grow heapUsed.
const _leak = []; // intentional global hold — prevents GC
router.get('/leak-memory', (_req, res) => {
  // ~12 MB of V8 heap: 120 000 objects × ~100 bytes each
  for (let i = 0; i < 120_000; i++) _leak.push({ id: i, payload: 'x'.repeat(80) });
  res.json({ ok: true, allocated: '~12 MB heap' });
});

// ── Outbound HTTP ──────────────────────────────────────────────────────────────

// Triggers: HTTP trace + insecure-http hint (plain http:// to remote host)
router.get('/outbound', (_req, res) => {
  http.get('http://httpbin.org/get', (remote) => {
    remote.resume();
    remote.on('end', () => res.json({ ok: true }));
  }).on('error', () => res.json({ ok: true, note: 'httpbin unreachable' }));
});

// ── Query hints: missing-where-delete ─────────────────────────────────────────

// Triggers: missing-where-delete (critical — deletes every row without WHERE)
router.post('/delete-all', async (_req, res) => {
  try {
    await db.query('DELETE FROM quote');
    res.json({ deleted: 'all rows' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Slow query ────────────────────────────────────────────────────────────────

// Triggers: slow-query event (pg_sleep(0.6) exceeds the 500ms pg default threshold)
router.get('/slow-query', async (_req, res) => {
  try {
    await db.query('SELECT pg_sleep(0.6)');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Transaction monitoring ────────────────────────────────────────────────────

// Triggers: transaction event with aborted=false (COMMIT)
// Note: pool.query() may use different connections per call; the DB-level transaction
// may be a no-op, but TransactionMonitor correlates by SQL pattern, not connection.
router.get('/transaction', async (_req, res) => {
  try {
    await db.query('BEGIN');
    await db.query('SELECT id FROM quote LIMIT 1');
    await db.query('COMMIT');
    res.json({ ok: true, outcome: 'committed' });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(500).json({ message: err.message });
  }
});

// Triggers: transaction event with aborted=true (ROLLBACK)
router.get('/rollback', async (_req, res) => {
  try {
    await db.query('BEGIN');
    await db.query('SELECT id FROM quote LIMIT 1');
    await db.query('ROLLBACK');
    res.json({ ok: true, outcome: 'rolled back' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Crash detection ───────────────────────────────────────────────────────────

// Triggers: crash event via unhandledRejection.
// CrashGuard intercepts the rejection and emits 'crash' without exiting the process
// (unhandledRejection is recoverable since Node 15+ when a listener is registered).
router.get('/crash', (_req, res) => {
  Promise.reject(new Error('[demo] Simulated unhandled rejection — .catch() was intentionally omitted'));
  res.json({ ok: true, note: 'unhandledRejection fired — watch for CRASH event' });
});

// ── DNS monitoring ────────────────────────────────────────────────────────────

// Triggers: dns event (+ slow-dns if resolution exceeds the 100ms threshold)
router.get('/dns-lookup', (_req, res) => {
  dns.lookup('example.com', (err, address) => {
    if (err) return res.json({ ok: false, error: err.message });
    res.json({ ok: true, address });
  });
});

// ── HTTP hint sinks ────────────────────────────────────────────────────────────
// These are internal targets used by the outbound routes below.
// They are NOT meant to be called directly from traffic.js.

router.get('/sink-500', (_req, res) => res.status(500).json({ error: 'demo server error' }));
router.get('/sink-429', (_req, res) => res.status(429).json({ error: 'demo rate limit' }));
router.get('/sink-slow', (_req, res) => { setTimeout(() => res.json({ ok: true }), 2500); });

// ── HTTP hints via outbound calls ─────────────────────────────────────────────

function selfGet(urlPath) {
  const port = parseInt(process.env.TARGET_PORT || '3000', 10);
  return new Promise((resolve) => {
    const req = http.request({ host: 'localhost', port, path: urlPath, method: 'GET' }, (r) => {
      r.resume();
      r.on('end', resolve);
    });
    req.on('error', resolve);
    req.end();
  });
}

// Triggers: http-server-error hint (outbound call receives 500)
router.get('/error-500', async (_req, res) => {
  await selfGet('/debug/sink-500');
  res.json({ ok: true });
});

// Triggers: http-rate-limited hint (outbound call receives 429)
router.get('/rate-limited', async (_req, res) => {
  await selfGet('/debug/sink-429');
  res.json({ ok: true });
});

// Triggers: slow-http-request hint (outbound call takes > 2000ms)
router.get('/slow-outbound', async (_req, res) => {
  await selfGet('/debug/sink-slow');
  res.json({ ok: true });
});

module.exports = router;
