# Argus — Implementation Reference Index

> This file is a navigation aid. Detailed implementation steps live in the phase files below.
> Strategic context and business rationale: see `diagnostic-agent-plan-final.md`.

---

## Product Name

**Argus** — from Argus Panoptes (Greek myth), the all-seeing guardian with 100 eyes who never slept.
Maps to: monitors everything across 16 DB drivers, HTTP, memory, CPU, logs, crashes — but never leaks data.

- Primary domain: `argus.dev` (or `getargus.dev`)
- npm package: `deep-diagnostic-agent` (existing, keep for continuity) or `@argus/agent`
- npm UI package: `@argus/ui`
- Docker image: `ghcr.io/argus-dev/platform`

---

## Cost Strategy — Zero Upfront

All phases launch on free tiers. Paid infrastructure is only introduced when revenue justifies it.

| Phase | Launch cost | Paid trigger |
|---|---|---|
| Phase 0 | $0 (npm publish is free) | — |
| Phase A | ~$0 (Supabase free, Vercel free, Resend free, Stripe charges only on transactions, GCP Secret Manager negligible) | — |
| Phase B.1 | ~$0 (Vercel serverless ingestor, ClickHouse free tier, Upstash free tier, OpenAI pay-per-use) | — |
| Phase B.2 | ~$10-15/mo Cloud Run min-instances | >100 active customers OR Vercel timeouts OR >$500 MRR |
| Phase C | $0 (GHCR free for public, Docker is free) | ClickHouse Cloud paid tier when storage grows |
| Phase D | $0 (Upstash QStash free tier for webhook retries) | Volume |

---

## Phase Files

| Phase | File | Gate | Launch cost |
|---|---|---|---|
| **Phase 0** | [Phase-0-OSS-Agent-Launch.md](Phase-0-OSS-Agent-Launch.md) | 50 named-bug testimonials | $0 |
| **Phase A** | [Phase-A-License-Authority.md](Phase-A-License-Authority.md) | 20 Self-Hosted Pro customers ($9,980 ARR) | ~$0 |
| **Phase B.1** | [Phase-B-Telemetry-SaaS.md](Phase-B-Telemetry-SaaS.md) §B.1 | First 100 online customers | ~$0 |
| **Phase B.2** | [Phase-B-Telemetry-SaaS.md](Phase-B-Telemetry-SaaS.md) §B.2 | >100 customers or Vercel limits | ~$10-15/mo |
| **Phase C** | [Phase-C-Docker-Platform.md](Phase-C-Docker-Platform.md) | 10 Enterprise contracts | $0 |
| **Phase D** | [Phase-D-Alerts-Integrations.md](Phase-D-Alerts-Integrations.md) | Measurable churn reduction | ~$0 |

**Phase ordering rationale:** C does not need to come before B. Self-Hosted Pro customers already have their own OTLP infrastructure (Jaeger, Grafana). The Docker dashboard in Phase C is an enhancement — their core value prop (offline license + privacy + 100% fidelity export) is fully delivered by Phase A.

---

## New Agent Abilities (Phase 0, ship before launch)

| Ability | File | Builder method | Emits |
|---|---|---|---|
| Correlation IDs | `src/instrumentation/correlation.ts` | auto-wired into HttpTracer | `correlationId` added to all events |
| Graceful Shutdown | `src/profiling/graceful-shutdown.ts` | `.withGracefulShutdown(opts?)` | `'info'` on signal received |
| Worker Threads Monitor | `src/profiling/worker-threads-monitor.ts` | `.withWorkerThreadsMonitor()` | `'anomaly'` on pool saturation/slow task |
| Slow Require Detector | `src/profiling/slow-require-detector.ts` | `.withSlowRequireDetector(opts?)` | structured slow-require events |
| Stream Leak Detector | `src/profiling/stream-leak-detector.ts` | `.withStreamLeakDetector(opts?)` | `'leak'` on unconsumed Readable > threshold |
| Circuit Breaker Detector | `src/analysis/circuit-breaker-detector.ts` | auto-wired into QueryAnalyzer/HttpTracer | `'anomaly'` with circuit-breaker suggestion |

All new abilities require tests at ≥90% line coverage before npm publish. See §0.7 in Phase-0-OSS-Agent-Launch.md.

---

## Monorepo Structure

```
/  (root — my-typescript-playground)
  packages/
    agent/          ← deep-diagnostic-agent (moved from src/)
    saas/           ← Next.js 14 App Router (Phase A+B)
      ingestor/     ← Cloud Run ingestor service (Phase B)
      worker/       ← Cloud Run worker service (Phase B)
    ui/             ← @argus/ui Team embedded components (Phase C)
    docker/         ← Self-Hosted Pro Docker image (Phase C)
  plans/
    diagnostic-agent-plan-final.md   ← strategic plan (source of truth)
    Implementation-Reference.md      ← this file
    Phase-0-OSS-Agent-Launch.md
    Phase-A-License-Authority.md
    Phase-B-Telemetry-SaaS.md
    Phase-C-Docker-Platform.md
    Phase-D-Alerts-Integrations.md
  pnpm-workspace.yaml
  package.json  (workspace root)
```

---

## Tier Summary (quick ref)

| Tier | Price | Internet | Dashboard | OTLP dest | fs events | AI |
|---|---|---|---|---|---|---|
| Free | $0 | Never | None | Local only | ✅ local | ❌ |
| Self-Hosted Pro | $499/yr | Once/yr | Docker self-hosted | Own infra | ✅ | BYOK |
| Individual | $19/mo | Monthly | SaaS | SaaS | ❌ | ❌ |
| Pro | $29/mo | Monthly | SaaS | SaaS | ❌ | ✅ 200/day |
| Team | $99/mo | Monthly | SaaS + embed | SaaS | ✅ | ✅ 1000/day + BYOK |
| Enterprise | $5k+/yr | Once/yr | Docker self-hosted | Own infra | ✅ | BYOK |

**No tier uses sampling.** All events in `allowedEvents` are exported at 100% fidelity.

---

## Clock Integrity Decision (offline tiers)

| Tier | Mitigation | Rationale |
|---|---|---|
| Self-Hosted Pro | None (Option 1) | Accepted trade-off. Misconfiguring clock = already have root access. |
| Enterprise | `process.hrtime.bigint()` delta (Option 3) | Contractual SLA makes silent abuse more consequential. 60s NTP tolerance. |

Implementation: `packages/agent/src/licensing/clock-guard.ts`

---

## Key Architectural Decisions

| Decision | Choice | Reason |
|---|---|---|
| License crypto | ECDSA P-256, ES256 JWT | Compact, fast offline verify |
| Public key | Bundled in npm package | Fully offline; rotation via `kid` claim |
| Private key storage | GCP Secret Manager only | Never in env files, never on laptops |
| Sampling | None on any tier | Data quality is the differentiator vs Datadog |
| Telemetry DB | ClickHouse Cloud, GCP eu-west-1 | Sub-second queries; same cloud as Cloud Run (no egress cost) |
| Ingestion path | Cloud Run + GCP Pub/Sub (2-stage) | < 10ms ACK to agent; decoupled from ClickHouse latency |
| JWT lifespan | 30 days (online), 365 days (offline) | No Redis revocation list needed |
| JWT sub claim | SHA-256(userId).slice(0,16) | Opaque — no raw identifiers in JWT payload |
| Trial anti-abuse | Email verify + per-domain DB index + IP rate limit | DB-enforced, not bypassable at application level |
| Dual fulfillment | Success page (sync) + webhook (async) | Customer sees key immediately, regardless of webhook lag |

---

## Test Strategy (cross-phase)

**Test runner:** Node.js built-in `--test` with `--experimental-strip-types` (already configured in root `package.json`).
**Coverage:** `node --test --experimental-test-coverage`. Target: ≥90% line coverage on all new code before each phase gate.

| Phase | Test location | Key coverage areas |
|---|---|---|
| 0 — Agent | `tests/licensing/`, `tests/instrumentation/correlation.test.ts`, `tests/profiling/graceful-shutdown.test.ts`, `tests/profiling/worker-threads-monitor.test.ts`, `tests/profiling/slow-require-detector.test.ts`, `tests/profiling/stream-leak-detector.test.ts`, `tests/analysis/circuit-breaker-detector.test.ts` | License validation, clock guard, expiry signal, all 6 new abilities |
| A — License Auth | `tests/licensing/generator.test.ts`, `tests/webhooks/stripe.test.ts`, `tests/trial/anti-abuse.test.ts`, `tests/billing/dual-fulfillment.test.ts` | JWT claims correctness, Stripe idempotency, trial anti-abuse, dual fulfillment |
| B — Telemetry | `tests/ingest/`, `tests/ai/`, `tests/conversion-email.test.ts`, `tests/webhooks/delivery.test.ts` | Ingest pipeline, tier enforcement, AI rate limits, email idempotency, HMAC |
| C — Docker | `tests/docker/`, `tests/ui/components.test.ts` | diagnose command, embedded ingestor, AI proxy, persistence |
| D — Alerts | `tests/alerting/` | Router, all 4 channels, retry backoff, dedup keys |

**Integration test runs:**

```bash
# Phase A — against Supabase local dev
npx supabase start && node --test tests/integration/phase-a/**

# Phase B — against local ClickHouse + Upstash test DB
node --test tests/integration/phase-b/**

# Phase C — Docker stack
docker compose -f packages/docker/docker-compose.yml up -d
node --test tests/integration/phase-c/**
```

---

## Security Checklist (cross-phase)

- [ ] **Private key:** GCP Secret Manager only. Never in `.env`, never in code, never on disk after initial generation.
- [ ] **License key storage:** SHA-256 hash only in DB — never plaintext.
- [ ] **API key storage:** SHA-256 hash only — never plaintext.
- [ ] **JWT `alg`:** Explicitly validate `=== 'ES256'`. Reject `none`, `HS*`.
- [ ] **JWT `sub`:** Opaque hash — no raw user identifiers.
- [ ] **Stripe webhooks:** Always `constructEvent()` before reading payload.
- [ ] **Offline Pro clock:** Accepted trade-off, documented. No code.
- [ ] **Enterprise clock:** `checkClockIntegrity()` via `hrtime`, 60s tolerance. Fallback = free mode.
- [ ] **Supabase RLS:** All tables. No row accessible without auth context.
- [ ] **ClickHouse:** Partitioned by `user_sub`. No cross-tenant reads possible.
- [ ] **Ingestor:** Hard-reject `self-hosted-pro` and `enterprise` tiers at Phase B endpoint.
- [ ] **Rate limiting:** 100 req/min per `sub` via Upstash Redis (Phase B+).
- [ ] **OTLP forward:** Strip `Authorization`, inject Grafana key server-side.
- [ ] **CSP headers:** On all dashboard pages (XSS prevention on sanitized query display).
- [ ] **CORS:** Explicit allowlist on `/api/v1/**` for `@argus/ui` consumer domains.
