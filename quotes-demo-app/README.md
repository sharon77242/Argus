# Argus Demo App

A small Express + PostgreSQL API that runs the Argus agent in dev mode and streams every monitoring event to the terminal in colour. Use it to see the agent in action before wiring it into your own project.

> **Pick one workflow — do not run both at the same time.**
> - **Local dev** (`docker-compose-pg-only.yml`) — Postgres in Docker, Node.js running natively on your machine. Best for iterating on the agent source.
> - **Full Docker** (`docker-compose.demo.yml`, repo root) — everything containerised; no local Node.js or pnpm required. Best for a clean one-command demo.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 14.18.0 (compiled) / ≥ 22.6.0 (source/dev) |
| Docker | any recent version |
| npm | ≥ 7 (bundled with Node.js) |
| pnpm | ≥ 8 — optional; only needed for step 1 (`npm run build` works too) |

---

## Local dev setup (one-time)

```bash
# 1. Build the agent package
cd packages/agent
pnpm build          # or: npm run build
cd ../..

# 2. Start Postgres and seed the database (17 programming quotes)
cd quotes-demo-app
docker compose -f docker-compose-pg-only.yml up -d
cd ..

# 3. Install demo dependencies
cd quotes-demo-app
npm install
```

---

## Run the simulation

```bash
# From quotes-demo-app/
node simulate.js
```

This starts the server, runs a scripted traffic sequence, then exits. You should see output like:

```
╔══════════════════════════════════════════╗
║  Argus — ACTIVE                          ║
╚══════════════════════════════════════════╝

20:36:19.791 [QUERY] [pg] SELECT id, quote, author FROM quote OFFSET $? LIMIT $? (50.3ms)
               ↳ hints: offset-pagination
20:36:19.794 [QUERY] [pg] SELECT id, quote, author FROM quote OFFSET $? LIMIT $? (126.9ms) ⚠ SLOW
               ↳ hints: offset-pagination
20:36:20.007 [QUERY] [pg] SELECT id, quote, author FROM quote OFFSET $? LIMIT $? (44.8ms)
               ↳ hints: offset-pagination, n-plus-one
20:36:20.501 [QUERY] [pg] INSERT INTO quote(quote, author) VALUES ($?, $?) RETURNING * (67.3ms)
20:36:20.503 [HTTP ] POST http://localhost/quotes → 500 (93.8ms)
DB connect string: [REDACTED_SECRET]
20:36:20.504 [SCRUB] console.log contained a high-entropy secret — redacted
20:36:20.601 [QUERY] [pg] SELECT * FROM quote (31.2ms)
               ↳ hints: no-select-star, missing-limit, full-table-scan
20:36:20.710 [QUERY] [pg] UPDATE quote SET updated_at = ? (8.4ms)
               ↳ hints: missing-where-update
20:36:20.820 [FS   ] readFileSync package.json (0.3ms)
               ↳ hints: [critical] synchronous-fs
20:36:20.923 [FS   ] readFileSync package.json (0.2ms)
               ↳ hints: [critical] synchronous-fs, [warning] missing-fs-cache
20:36:21.010 [LOG  ] console.log → [info] unstructured-log
20:36:21.050 [LOG  ] console.log → [warning] large-log-payload
20:36:21.110 [LOG  ] console.error → [critical] log-error-storm
20:36:21.671 [HTTP ] GET http://httpbin.org/get → 200 (437.6ms)
               ↳ hints: insecure-http
20:36:21.902 [SCAN ] static analysis complete — 0 issue(s) across 1 tool(s)
```

**What each tag demonstrates:**

| Tag | Rule fired | Trigger |
|---|---|---|
| `[QUERY]` | — | Every `pg` call intercepted via `diagnostics_channel`; values sanitised to `?` |
| `↳ offset-pagination` | `QueryAnalyzer` | `OFFSET` pagination degrades at scale |
| `↳ n-plus-one` | `QueryAnalyzer` | Same query ≥ 5× within 1 s |
| `↳ no-select-star` | `QueryAnalyzer` | `SELECT *` fetches all columns |
| `↳ full-table-scan` | `QueryAnalyzer` | `SELECT` without `WHERE` or `LIMIT` |
| `↳ missing-where-update` | `QueryAnalyzer` ⚠ critical | `UPDATE` without `WHERE` touches every row |
| `[FS   ]` | `FsAnalyzer` | `fs.readFileSync` / `readFile` calls intercepted |
| `↳ synchronous-fs` | `FsAnalyzer` ⚠ critical | Sync fs call blocks the event loop |
| `↳ missing-fs-cache` | `FsAnalyzer` | Same file read 5+ times within 1 s |
| `[LOG  ]` | `LogAnalyzer` | `console.log/warn/error` intercepted |
| `↳ unstructured-log` | `LogAnalyzer` | Mixing raw strings and objects in one log call |
| `↳ large-log-payload` | `LogAnalyzer` | Log payload > 5 KB can block the event loop |
| `↳ log-error-storm` | `LogAnalyzer` ⚠ critical | 5+ `console.error` calls within 1 s |
| `[HTTP ]` | `HttpAnalyzer` | Outbound HTTP/HTTPS captured via `diagnostics_channel` |
| `↳ insecure-http` | `HttpAnalyzer` ⚠ critical | Plain `http://` request to a remote host |
| `[SCRUB]` | `EntropyChecker` | High-entropy token in a log call — replaced with `[REDACTED_SECRET]` |
| `[ANOM ]` | `RuntimeMonitor` | Event-loop lag > threshold (busy-spin demo) |
| `[SCAN ]` | `StaticScanner` | TypeScript Compiler API on startup |

---

## Run as a long-running server

```bash
# From quotes-demo-app/
node ./bin/www
```

Then hit the API manually:

```bash
# List quotes (page 1)
curl http://localhost:3000/quotes

# List page 2
curl http://localhost:3000/quotes?page=2

# Add a quote
curl -X POST http://localhost:3000/quotes \
  -H 'Content-Type: application/json' \
  -d '{"quote":"Make it work, make it right, make it fast.","author":"Kent Beck"}'
```

---

## Fully containerised (optional)

Run both the API and Postgres inside Docker — no local Node.js or pnpm required:

```bash
# From the repo root
docker compose -f docker-compose.demo.yml up --build
```

Logs from the agent stream to stdout. Press `Ctrl-C` to stop, then:

```bash
docker compose -f docker-compose.demo.yml down -v
```

---

## Teardown (local dev)

```bash
cd quotes-demo-app
docker compose -f docker-compose-pg-only.yml down
```
