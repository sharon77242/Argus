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

## Phase Files

| Phase | File | Gate |
|---|---|---|
| **Phase 0** | [Phase-0-OSS-Agent-Launch.md](Phase-0-OSS-Agent-Launch.md) | 50 named-bug testimonials |
| **Phase A** | [Phase-A-License-Authority.md](Phase-A-License-Authority.md) | 20 Self-Hosted Pro customers ($9,980 ARR) |
| **Phase B** | [Phase-B-Telemetry-SaaS.md](Phase-B-Telemetry-SaaS.md) | $5,000 MRR from online tiers |
| **Phase C** | [Phase-C-Docker-Platform.md](Phase-C-Docker-Platform.md) | 10 Enterprise contracts |
| **Phase D** | [Phase-D-Alerts-Integrations.md](Phase-D-Alerts-Integrations.md) | Measurable churn reduction |

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
