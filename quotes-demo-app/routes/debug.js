'use strict';

/**
 * Debug routes — intentionally trigger every DiagnosticAgent monitoring feature.
 * Never use patterns like these in production code.
 */

const express = require('express');
const router = express.Router();
const db = require('../services/db');
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

module.exports = router;
