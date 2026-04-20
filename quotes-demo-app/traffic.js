'use strict';
/**
 * traffic.js — sends a scripted sequence of requests to a RUNNING quotes server.
 *
 * Works against any host:
 *   node traffic.js                        # localhost:3000 (local dev)
 *   TARGET_HOST=api TARGET_PORT=3000 node traffic.js  # inside Docker Compose
 */

const http = require('http');

const HOST = process.env.TARGET_HOST || 'localhost';
const PORT = parseInt(process.env.TARGET_PORT || '3000', 10);

// ── helpers ───────────────────────────────────────────────────────────────────

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function get(urlPath) {
  return new Promise((resolve) => {
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const obj = JSON.parse(body);
          const preview = Array.isArray(obj?.data)
            ? `[${obj.data.length} records]`
            : JSON.stringify(obj).slice(0, 60);
          console.log(`  [TRAFFIC] → ${res.statusCode} ${preview}`);
        } catch { console.log(`  [TRAFFIC] → ${res.statusCode} ${body.slice(0, 60)}`); }
        resolve();
      });
    });
    req.on('error', (e) => { console.log(`  [TRAFFIC] → ERROR ${e.message}`); resolve(); });
    req.end();
  });
}

function post(urlPath, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = http.request({
      host: HOST, port: PORT, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let respBody = '';
      res.on('data', d => respBody += d);
      res.on('end', () => { console.log(`  [TRAFFIC] → ${res.statusCode} ${respBody.slice(0, 80)}`); resolve(); });
    });
    req.on('error', (e) => { console.log(`  [TRAFFIC] → ERROR ${e.message}`); resolve(); });
    req.write(data);
    req.end();
  });
}

// ── traffic sequence ──────────────────────────────────────────────────────────

async function run() {
  console.log(`\n[TRAFFIC] Sending demo traffic to ${HOST}:${PORT}...\n`);

  console.log('[TRAFFIC] ── GET / (health check) ────────────────────────────────────');
  await get('/');

  console.log('\n[TRAFFIC] ── GET /quotes (offset-pagination hint) ────────────────────');
  await get('/quotes');
  await wait(100);

  console.log('\n[TRAFFIC] ── N+1: GET /quotes?page=1 × 6 ────────────────────────────');
  for (let i = 0; i < 6; i++) await get('/quotes?page=1');
  await wait(200);

  console.log('\n[TRAFFIC] ── POST /quotes (INSERT) ───────────────────────────────────');
  await post('/quotes', { quote: 'Make it work, make it right, make it fast.', author: 'Kent Beck' });

  console.log('\n[TRAFFIC] ── GET /debug/scrub (SCRUB: high-entropy secret) ───────────');
  await get('/debug/scrub');
  await wait(100);

  console.log('\n[TRAFFIC] ── GET /debug/busy-spin (ANOM: event-loop lag) ──────────────');
  await get('/debug/busy-spin');
  await wait(500);

  console.log('\n[TRAFFIC] ── GET /debug/select-star (no-select-star + full-table-scan) ─');
  await get('/debug/select-star');
  await wait(100);

  console.log('\n[TRAFFIC] ── POST /debug/update-all (missing-where-update: critical) ───');
  await post('/debug/update-all', {});
  await wait(100);

  console.log('\n[TRAFFIC] ── GET /debug/sync-read × 5 (synchronous-fs + missing-fs-cache) ─');
  for (let i = 0; i < 5; i++) await get('/debug/sync-read');
  await wait(100);

  console.log('\n[TRAFFIC] ── GET /debug/log-unstructured (unstructured-log hint) ────────');
  await get('/debug/log-unstructured');
  await wait(50);

  console.log('\n[TRAFFIC] ── GET /debug/log-large (large-log-payload hint) ──────────────');
  await get('/debug/log-large');
  await wait(50);

  console.log('\n[TRAFFIC] ── GET /debug/log-storm (log-error-storm hint) ─────────────────');
  await get('/debug/log-storm');
  await wait(100);

  console.log('\n[TRAFFIC] ── GET /debug/path-traversal (path-traversal-risk hint) ────────');
  await get('/debug/path-traversal');
  await wait(50);

  console.log('\n[TRAFFIC] ── GET /debug/sensitive-file (sensitive-file-access hint) ──────');
  await get('/debug/sensitive-file');
  await wait(50);

  console.log('\n[TRAFFIC] ── GET /debug/leak-memory (memory-leak anomaly) ──────────────');
  await get('/debug/leak-memory');
  await wait(1500); // wait for RuntimeMonitor interval to fire

  console.log('\n[TRAFFIC] ── GET /debug/outbound (insecure-http hint) ──────────────────');
  await get('/debug/outbound');
  await wait(200);

  console.log('\n[TRAFFIC] ── POST /debug/delete-all (missing-where-delete: critical) ────');
  await post('/debug/delete-all', {});
  await wait(100);

  console.log('\n[TRAFFIC] ── GET /debug/slow-query (slow-query: 600ms > 500ms threshold) ─');
  await get('/debug/slow-query');
  await wait(200);

  console.log('\n[TRAFFIC] ── GET /debug/transaction (transaction: COMMIT) ─────────────────');
  await get('/debug/transaction');
  await wait(100);

  console.log('\n[TRAFFIC] ── GET /debug/rollback (transaction: ROLLBACK / aborted) ────────');
  await get('/debug/rollback');
  await wait(100);

  console.log('\n[TRAFFIC] ── GET /debug/crash (crash: unhandledRejection) ──────────────────');
  await get('/debug/crash');
  await wait(200); // allow CrashGuard to emit the event

  console.log('\n[TRAFFIC] ── GET /debug/dns-lookup (dns + possible slow-dns) ──────────────');
  await get('/debug/dns-lookup');
  await wait(200);

  console.log('\n[TRAFFIC] ── GET /debug/error-500 (http-server-error hint) ─────────────────');
  await get('/debug/error-500');
  await wait(100);

  console.log('\n[TRAFFIC] ── GET /debug/rate-limited (http-rate-limited hint) ──────────────');
  await get('/debug/rate-limited');
  await wait(100);

  console.log('\n[TRAFFIC] ── GET /debug/slow-outbound (slow-http-request hint, ~2.5s) ──────');
  await get('/debug/slow-outbound');
  await wait(200);

  console.log('\n[TRAFFIC] ── Done ───────────────────────────────────────────────────────\n');
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => { console.error('[TRAFFIC] fatal:', err.message); process.exit(1); });
}
