# Argus Demo — Simulation Scenarios

Run with: `node simulate.js` (requires Postgres; see `docker-compose-pg-only.yml`).

The simulator boots an Express server, attaches the ArgusAgent, then replays the traffic sequence below. Each scenario triggers a specific agent feature and prints a labelled event to the terminal.

---

## Traffic sequence

| Step | Route | Agent event / hint | Label |
|------|-------|--------------------|-------|
| 1 | `GET /` | health check (no event) | — |
| 2 | `GET /quotes` | `offset-pagination` hint | QUERY |
| 3 | `GET /quotes?page=1` × 6 | `n-plus-one` hint (repeated identical queries) | QUERY |
| 4 | `POST /quotes` | clean INSERT, no hints | QUERY |
| 5 | `GET /debug/scrub` | high-entropy secret redacted from log | SCRUB |
| 6 | `GET /debug/busy-spin` | 120ms synchronous busy-loop → `event-loop-lag` anomaly | ANOM |
| 7 | `GET /debug/select-star` | `no-select-star` + `missing-limit` + `full-table-scan` hints | QUERY |
| 8 | `POST /debug/update-all` | `missing-where-update` hint (critical) | QUERY |
| 9 | `GET /debug/sync-read` × 5 | `synchronous-fs` hint (every call) + `missing-fs-cache` hint (5th call) | FS |
| 10 | `GET /debug/log-unstructured` | `unstructured-log` hint | LOG |
| 11 | `GET /debug/log-large` | `large-log-payload` hint | LOG |
| 12 | `GET /debug/log-storm` | `log-error-storm` hint (6 errors in < 1 s) | LOG |
| 13 | `GET /debug/path-traversal` | `path-traversal-risk` hint | FS |
| 14 | `GET /debug/sensitive-file` | `sensitive-file-access` hint (.env) | FS |
| 15 | `GET /debug/leak-memory` | ~12 MB V8 heap growth → `memory-leak` anomaly | ANOM |
| 16 | `GET /debug/outbound` | `insecure-http` hint (plain http:// to remote host) | HTTP |
| 17 | `POST /debug/delete-all` | `missing-where-delete` hint (critical — no WHERE clause) | QUERY |
| 18 | `GET /debug/slow-query` | `pg_sleep(0.6)` exceeds 500 ms pg threshold → `slow-query` event | SLOW |
| 19 | `GET /debug/transaction` | `BEGIN` / `SELECT` / `COMMIT` cycle → `transaction` event (committed) | TXN |
| 20 | `GET /debug/rollback` | `BEGIN` / `SELECT` / `ROLLBACK` cycle → `transaction` event (aborted) | TXN |
| 21 | `GET /debug/crash` | `Promise.reject()` with no `.catch()` → `unhandledRejection` → `crash` event | CRASH |
| 22 | `GET /debug/dns-lookup` | `dns.lookup('example.com')` → `dns` event (+ `slow-dns` if > 100 ms) | DNS |
| 23 | `GET /debug/error-500` | outbound HTTP call receives 500 → `http-server-error` hint | HTTP |
| 24 | `GET /debug/rate-limited` | outbound HTTP call receives 429 → `http-rate-limited` hint | HTTP |
| 25 | `GET /debug/slow-outbound` | outbound HTTP call takes ~2.5 s → `slow-http-request` hint | HTTP |

Startup also fires:
- `audit` — npm audit scan for high/critical CVEs
- `scan` — static analysis (TypeScript + ESLint diagnostics)

---

## Agent features exercised

| Feature | Triggered by |
|---------|-------------|
| Query analysis (7 rules) | steps 2–3, 7–8, 17 |
| Slow query monitor | step 18 |
| Transaction monitor | steps 19–20 |
| Runtime monitor — event-loop lag | step 6 |
| Runtime monitor — memory leak | step 15 |
| Log instrumentation + scrubbing | steps 5, 10–12 |
| FS instrumentation | steps 9, 13–14 |
| HTTP instrumentation + analysis | steps 16, 23–25 |
| DNS monitor | step 22 |
| GC monitor | passive (fires if GC pauses exceed 10% of 10 s window) |
| Crash guard | step 21 |
| Resource leak monitor | passive (fires if OS handles exceed threshold) |
| Audit scanner | startup |
| Static scanner | startup |

---

## Monitors enabled but not directly triggered

- **GC pressure** (`gc-pressure`): enabled via `withGcMonitor()`. Fires automatically if accumulated GC pause time exceeds 10% of the 10-second sliding window. No synthetic trigger is needed.
- **Pool exhaustion / slow-acquire**: requires calling `agent.watchPool(pool, 'pg')` with a registered pg pool. Not wired in this demo; add it in `diagnostic.js` to observe `pool-exhaustion` and `slow-acquire` events under load.
