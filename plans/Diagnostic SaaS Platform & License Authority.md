# Project: Diagnostic SaaS Platform & License Authority

## Overview

The system is split into two independent services built in sequence:

1. **License Authority** — minimal server, serves all tiers including fully offline users. The only service that must never go down.
2. **Telemetry SaaS** — online dashboard, ClickHouse ingestion, AI suggestions, API, webhooks. Built after the License Authority is stable.

```
┌──────────────────────────────┐     Phase A (build first)
│   License Authority           │  ← Auth + Billing + JWT issuance
│   Supabase + Stripe + ECDSA  │  ← serves Free, Offline Pro, Online tiers
└──────────────────────────────┘

┌──────────────────────────────┐     Phase B (build after)
│   Telemetry SaaS              │  ← Ingestion + Dashboard + AI + API
│   ClickHouse + Next.js        │  ← serves Individual, Online Pro + Team only
└──────────────────────────────┘
```

The License Authority going down is critical. The Telemetry SaaS going down affects only online dashboards — offline and free users are completely unaffected.

---

## Pricing Model

| | Free | Offline Pro | Individual | Pro | Team |
|---|---|---|---|---|---|
| **Price** | $0 | $799/year | $9/mo | $29/mo | $99/mo |
| **License key** | ❌ | ✅ Annual JWT | ✅ 30-day JWT | ✅ 30-day JWT | ✅ 30-day JWT |
| **SaaS used** | None | License Authority only | Both | Both | Both |
| **OTLP destination** | Local EventEmitter only | User's own endpoint | SaaS | SaaS | SaaS |
| **Services monitored** | Unlimited (local) | Unlimited | 1 | 5 | Unlimited |
| **Event types exported** | N/A | All (user's infra) | crash, anomaly, leak | + query (10%), http (10%), log (5%) | All, full fidelity |
| **Trace retention** | N/A | User's infra | 7 days | 30 days | 90 days |
| **AI fix suggestions** | ❌ | ✅ On-demand (manual paste) | ❌ | ✅ Automatic | ✅ Automatic (priority) |
| **REST API** | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Webhooks** | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Custom embedded UI** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Team seats** | 1 | Unlimited | 1 | 3 | Unlimited |
| **Free trial** | — | ✅ 14 days, no card | 14 days | 14 days | 14 days |
| **SaaS dashboard** | ❌ | ❌ (by design) | ✅ | ✅ | ✅ |
| **Account/billing page** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Internet required** | Never | Once/year (manual renewal) | Monthly JWT renewal | Monthly JWT renewal | Monthly JWT renewal |

### Offline Pro — Intentional Design

Offline Pro users own their entire observability stack. The SaaS is purely a **license issuing authority** for them — not a data store, not a dashboard. They configure `DIAGNOSTIC_OTEL_ENDPOINT` to point at their existing infrastructure (local Jaeger, Grafana Alloy, corporate Datadog, anything OTEL-compatible). They manage and visualize their own data.

What they get from `saas.example.com`:
- `/account` — billing management, Stripe portal link
- `/account/license` — generate / renew license key
- `/account/analyze` — manual AI query analysis (paste a sanitized query, get LLM-powered suggestions)

**No telemetry dashboard. This is intentional, not a missing feature.**

The agent never contacts the SaaS. But the *user* can visit `/account/analyze` in their browser, paste a sanitized query copied from their own Jaeger/Grafana, and receive AI suggestions. Their telemetry data stays entirely within their infrastructure — only the single query they choose to manually submit is shared.

### Offline Pro JWT lifecycle

```
Day 0:   User pays on their laptop → dashboard shows 1-year JWT
         → copies DIAGNOSTIC_LICENSE_KEY=eyJ... into container env vars
         → agent validates ECDSA offline, exports OTLP to their endpoint
         → zero server contact during operation

Day 365: JWT expires
         → agent falls back to free local mode (does NOT crash, does NOT stop monitoring)
         → writes diagnostic_agent_EXPIRED.txt to process.cwd()
         → emits 'info' at every startup:
           "License expired. Renew at: https://saas.example.com/account/license
            Paste the new DIAGNOSTIC_LICENSE_KEY and restart."
         → user goes to that URL on their laptop, clicks Reissue, copies new JWT
         → sets env var, restarts — back to Offline Pro
         → agent never made a single outbound HTTP call
```

Expiry signal is **written to disk** (not just emitted), ensuring it survives container log rotation and is visible even when no `'info'` listener is registered.

### Event export matrix

Agent applies `allowedEvents` and `sampleRates` from JWT **locally before sending.** The ingestion endpoint validates but does not need to resample. This prevents sending 100% of events across the network only to discard 90% server-side.

```ts
// JWT claims include:
allowedEvents: ['crash', 'anomaly', 'leak', 'query', 'http', 'log'],
sampleRates: { query: 0.10, http: 0.10, log: 0.05 }
// crash, anomaly, leak default to 1.0 (omitted = full rate)
```

| Event type | Individual | Pro | Team / Offline Pro |
|---|---|---|---|
| `crash` | ✅ 100% | ✅ 100% | ✅ 100% |
| `anomaly` | ✅ 100% | ✅ 100% | ✅ 100% |
| `leak` | ✅ 100% | ✅ 100% | ✅ 100% |
| `query` | ❌ | ✅ 10% sampled | ✅ 100% |
| `http` | ❌ | ✅ 10% sampled | ✅ 100% |
| `log` | ❌ | ✅ 5% sampled | ✅ 100% |
| `fs` | ❌ | ❌ | ✅ 100% (Team/Offline) |

---

## Architecture Decision Record

| Concern | Decision | Rationale |
|---|---|---|
| Auth provider | **Supabase Auth** | JWTs, refresh tokens, RLS; PostgreSQL native |
| User/billing DB | **Supabase (PostgreSQL)** | Low row count, relational; RLS for multi-tenancy |
| Telemetry DB | **ClickHouse Cloud** | Columnar, time-series, sub-second aggregations at scale |
| License crypto | **ECDSA P-256** (JWT, ES256) | Compact, fast offline verify |
| Public key distribution | **Bundled in npm package** | Works fully offline; rotation via `kid` claim |
| JWT lifespan — online tiers | **30 days**, re-issued on `invoice.payment_succeeded` | No Redis revocation list; cancellations take ≤30 days |
| JWT lifespan — Offline Pro | **365 days**, re-issued manually by user | Truly air-gapped; user initiates renewal on their own device |
| Revocation | **JWT expiry only** | No Redis needed; acceptable lag (30d online, 365d offline) |
| Sampling | **Agent-side** using `sampleRates` JWT claim | Avoids sending 100% over network only to discard at server |
| OTLP forwarding (online) | Custom ingest → **Grafana Cloud** | Skip building a collector |
| Payments | **Stripe Checkout + Billing Portal** | Subscriptions + annual plans, `trial_period_days: 14` |
| Frontend | **Next.js 14 (App Router)** on Vercel | Co-located API routes; Stripe webhook handler server-side |
| Transactional email | **Resend** | Simple API, best developer experience, generous free tier |
| mTLS | **Optional** in `withExporter` | Offline Pro users target local endpoints without TLS |
| CORS | **Explicit allowlist** on `/api/v1/**` | Required for `@diagnostic-agent/ui` on customer domains |

---

## Phase 0: Agent Prerequisites

### 0.1 — Version stamping

```ts
// src/export/exporter.ts
resourceAttributes: {
  'diagnostic_agent.version': pkg.version,
  'service.name': config.serviceName ?? 'unknown',
}
```

### 0.2 — Make TLS optional in `withExporter`

```ts
// ExporterConfig update
export interface ExporterConfig {
  endpointUrl: string;
  key?:  Buffer;  // optional — omit for plaintext/local endpoints
  cert?: Buffer;
  ca?:   Buffer;
}
```

### 0.3 — License validation (offline ECDSA)

```ts
// src/licensing/license-validator.ts
import { createVerify } from 'node:crypto';
import { BUNDLED_PUBLIC_KEYS } from './public-key.ts';

export interface LicenseClaims {
  sub: string;           // opaque user identifier (not raw userId)
  tier: 'offline-pro' | 'individual' | 'pro' | 'team';
  maxServices: number | null;
  allowedEvents: string[];
  sampleRates: Record<string, number>;
  kid: string;
  exp: number;
}

export function validateLicense(jwt: string): LicenseClaims {
  const [headerB64, payloadB64, sigB64] = jwt.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error('Malformed license key');

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  if (header.alg !== 'ES256') throw new Error(`Unsupported algorithm: ${header.alg}`);

  const pubKey = BUNDLED_PUBLIC_KEYS[header.kid];
  if (!pubKey) throw new Error(`Unknown key ID: ${header.kid}`);

  const verify = createVerify('SHA256');
  verify.update(`${headerB64}.${payloadB64}`);
  const valid = verify.verify(pubKey, Buffer.from(sigB64, 'base64url'));
  if (!valid) throw new Error('License signature invalid');

  const claims: LicenseClaims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  if (Date.now() / 1000 > claims.exp) throw new Error('EXPIRED');

  return claims;
}
```

Note: `sub` is an opaque SHA-256 hash of the internal userId — JWT payload is base64-encoded (not encrypted), so no raw user identifiers go into claims.

### 0.4 — Startup + expiry behavior

```ts
const licenseKey = process.env.DIAGNOSTIC_LICENSE_KEY;

if (!licenseKey) {
  // Free mode — silent
} else {
  try {
    const claims = validateLicense(licenseKey);
    agent.emit('info', `DiagnosticAgent: tier=${claims.tier}, expires=${new Date(claims.exp * 1000).toISOString()}`);
    applyTierConfig(agent, claims);
  } catch (err) {
    if ((err as Error).message === 'EXPIRED') {
      const msg =
        'DiagnosticAgent: license key expired — running in free local mode.\n' +
        'Renew at: https://saas.example.com/account/license\n' +
        'Paste the new key as DIAGNOSTIC_LICENSE_KEY and restart.';

      // Durable signal: write to disk (survives log rotation, no listener required)
      import('node:fs').then(fs =>
        fs.writeFileSync(
          import.meta.dirname + '/diagnostic_agent_EXPIRED.txt',
          msg + '\n'
        )
      );
      agent.emit('info', msg);
    } else {
      agent.emit('error', new Error(`DiagnosticAgent: invalid license — ${(err as Error).message}`));
    }
    // Always continue in free local mode — never crash, never stop monitoring
  }
}
```

### 0.5 — Agent-side sampling

```ts
// In the instrumentation engine, before emitting events:
function shouldSample(eventType: string, sampleRates: Record<string, number>): boolean {
  const rate = sampleRates[eventType] ?? 1.0;
  return Math.random() < rate;
}
```

Events not in `allowedEvents` are dropped locally. Events in `allowedEvents` are sampled at the configured rate. Zero events are transmitted to the server for filtered/sampled-out events.

### 0.6 — `kid`-based public key bundle

```ts
// src/licensing/public-key.ts (auto-generated by scripts/embed-pubkey.ts at publish)
export const BUNDLED_PUBLIC_KEYS: Record<string, string> = {
  'k1': '-----BEGIN PUBLIC KEY-----\n...',
  // old keys are NEVER removed — needed to validate unexpired old JWTs
};
```

---

## Phase A: License Authority

The minimum viable server. Deployed first, required for Offline Pro. Small, cheap, must be highly available.

### Services: Supabase + Stripe + Resend + Vercel. No ClickHouse. No Redis. No Grafana.

### Database schema (Supabase / PostgreSQL)

```sql
create table public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text not null,
  tier                   text not null default 'free'
                           check (tier in ('free','offline-pro','individual','pro','team')),
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  plan_expires_at        timestamptz,
  created_at             timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Own profile only" on public.profiles using (auth.uid() = id);

-- Issued license key audit log (SHA-256 hash only — not used for runtime lookups)
create table public.license_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade,
  key_hash    text not null unique,
  tier        text not null,
  issued_at   timestamptz default now(),
  expires_at  timestamptz not null
);

alter table public.license_keys enable row level security;
create policy "Own keys" on public.license_keys using (auth.uid() = user_id);
```

### API routes (Phase A only)

```
POST /api/auth/signup
POST /api/auth/login      → on success, re-issue license JWT if subscription active
POST /api/auth/logout
GET  /api/me              → { tier, planExpiresAt, licenseExpiresAt }

GET  /api/billing/checkout?plan=offline-pro|individual|pro|team
GET  /api/billing/portal  → Stripe customer portal redirect
POST /api/webhooks/stripe

POST /api/trial/offline-pro  → issue 14-day trial JWT (no card, email-verified)
POST /api/license/generate   → issue JWT (auth required, paid tier)
POST /api/license/renew      → re-issue JWT (auth required, subscription active)
```

Pages served:
- `/` — marketing / pricing
- `/trial` — Offline Pro trial signup (email + verify, no card)
- `/account` — billing status, Stripe portal link (all paid tiers including Offline Pro)
- `/account/license` — generate / rotate license key (all paid tiers)
- `/account/analyze` — manual AI query analysis (all paid tiers including trial)
- `/dashboard/**` — Phase B only (Individual, Pro, Team)

### Stripe integration

```ts
const STRIPE_CONFIG = {
  'offline-pro': { priceId: process.env.STRIPE_OFFLINE_PRO_PRICE_ID!, mode: 'payment' as const,      trial: false },
  'individual':  { priceId: process.env.STRIPE_INDIVIDUAL_PRICE_ID!, mode: 'subscription' as const,  trial: true  },
  'pro':         { priceId: process.env.STRIPE_PRO_PRICE_ID!,        mode: 'subscription' as const,  trial: true  },
  'team':        { priceId: process.env.STRIPE_TEAM_PRICE_ID!,       mode: 'subscription' as const,  trial: true  },
};

const session = await stripe.checkout.sessions.create({
  customer_email: user.email,
  line_items: [{ price: config.priceId, quantity: 1 }],
  mode: config.mode,
  trial_period_days: config.trial ? 14 : undefined,
  success_url: `${BASE_URL}/account/license`,
  cancel_url:  `${BASE_URL}/pricing`,
  metadata: { userId: user.id, plan },
});
```

Note: Offline Pro uses Stripe `mode: 'payment'` (one-time annual), not `'subscription'`. The webhook event for one-time payments is `checkout.session.completed` only — no `invoice.payment_succeeded` recurring.

### Stripe webhooks

| Event | Action |
|---|---|
| `checkout.session.completed` | Set `tier = metadata.plan`; issue initial license JWT; send welcome email via Resend |
| `customer.subscription.updated` | Update tier on plan change (handles upgrades/downgrades) |
| `invoice.payment_succeeded` | Re-issue 30-day JWT for subscription tiers (Individual/Pro/Team) |
| `invoice.payment_failed` | Set `tier = 'free'`; send warning email |
| `customer.subscription.deleted` | Set `tier = 'free'`; nullify subscription columns |

All handlers are **idempotent**. Idempotency key: `stripe_subscription_id` for subscriptions, `checkout.session.id` for one-time payments.

### License generation

```ts
// app/api/license/generate/route.ts
const TIER_CONFIG = {
  'offline-pro': {
    maxServices:   null,
    allowedEvents: ['crash','anomaly','leak','query','http','log','fs'],
    sampleRates:   {},   // all 1.0
    expDays:       365,
  },
  'individual': {
    maxServices:   1,
    allowedEvents: ['crash','anomaly','leak'],
    sampleRates:   {},
    expDays:       30,
  },
  'pro': {
    maxServices:   5,
    allowedEvents: ['crash','anomaly','leak','query','http','log'],
    sampleRates:   { query: 0.10, http: 0.10, log: 0.05 },
    expDays:       30,
  },
  'team': {
    maxServices:   null,
    allowedEvents: ['crash','anomaly','leak','query','http','log','fs'],
    sampleRates:   {},
    expDays:       30,
  },
};

const config = TIER_CONFIG[profile.tier];
const sub = createHash('sha256').update(user.id).digest('hex').slice(0, 16); // opaque

const claims = {
  sub,
  tier:          profile.tier,
  maxServices:   config.maxServices,
  allowedEvents: config.allowedEvents,
  sampleRates:   config.sampleRates,
  kid:           process.env.KEY_ID,
  iat:           Math.floor(Date.now() / 1000),
  exp:           Math.floor(Date.now() / 1000) + config.expDays * 24 * 3600,
};

const licenseKey = jwt.sign(claims, process.env.PRIVATE_KEY!, { algorithm: 'ES256' });

// Store SHA-256 hash only — never plaintext
await supabase.from('license_keys').insert({
  user_id:    user.id,
  key_hash:   createHash('sha256').update(licenseKey).digest('hex'),
  tier:       profile.tier,
  expires_at: new Date(claims.exp * 1000).toISOString(),
});
```

### Offline Pro trial (no credit card, 14 days)

Functionally identical to a paid Offline Pro JWT — same `allowedEvents`, `sampleRates`, and `/account/analyze` access (20 AI calls/day). Only difference: 14-day `exp` and `trial: true` in claims for audit purposes.

**Anti-abuse mitigations:**
1. **Email verification required** — JWT not issued until email is confirmed; blocks temp-mail services
2. **1 trial per email domain** — enforced via DB unique index; corporate teams can't cycle individual addresses
3. **IP rate limit** — max 3 trial signups per IP per 24h (DB count in Phase A, Upstash Redis in Phase B)
4. **JWT is cryptographically time-locked** — `exp` is in the signed payload; no server call can extend it

```sql
-- Additional columns on profiles (Phase A schema update)
alter table public.profiles
  add column email_domain       text generated always as (split_part(email, '@', 2)) stored,
  add column offline_trial_used boolean not null default false,
  add column offline_trial_at   timestamptz;

-- Enforces one trial per domain at the DB level
create unique index one_trial_per_domain
  on public.profiles (email_domain)
  where offline_trial_used = true;
```

```ts
// app/api/trial/offline-pro/route.ts
if (profile.offline_trial_used) {
  return Response.json({ error: 'TRIAL_ALREADY_USED' }, { status: 403 });
}

const { count } = await supabase
  .from('profiles')
  .select('*', { count: 'exact', head: true })
  .eq('email_domain', profile.email_domain)
  .eq('offline_trial_used', true);

if (count && count > 0) {
  return Response.json({ error: 'DOMAIN_TRIAL_USED',
    message: 'Your organization has already used the Offline Pro trial.' }, { status: 403 });
}

const config = TIER_CONFIG['offline-pro'];
const claims = {
  sub:           opaqueHash(user.id),
  tier:          'offline-pro' as const,
  trial:         true,             // audit only — not enforced by agent
  maxServices:   config.maxServices,
  allowedEvents: config.allowedEvents,
  sampleRates:   config.sampleRates,
  kid:           process.env.KEY_ID,
  iat:           Math.floor(Date.now() / 1000),
  exp:           Math.floor(Date.now() / 1000) + 14 * 24 * 3600,
};

const trialKey = jwt.sign(claims, process.env.PRIVATE_KEY!, { algorithm: 'ES256' });

await supabase.from('profiles').update({
  offline_trial_used: true,
  offline_trial_at:   new Date().toISOString(),
}).eq('id', user.id);

await supabase.from('license_keys').insert({
  user_id:    user.id,
  key_hash:   createHash('sha256').update(trialKey).digest('hex'),
  tier:       'offline-pro-trial',
  expires_at: new Date(claims.exp * 1000).toISOString(),
});
```

When the trial expires, the agent's renewal message links to `/pricing` (not `/account/license`), prompting purchase.

---

## Phase B: Telemetry SaaS (Online Tiers Only)

Built after Phase A is stable. Serves `individual`, `pro`, and `team` tiers. Offline Pro users **never** contact this service.

### Additional services: ClickHouse Cloud + Grafana Cloud + Upstash Redis + OpenAI + Resend (shared with Phase A)

### Telemetry database (ClickHouse Cloud)

Per-user retention is enforced via a `retention_days` column written at ingest time. This avoids the ClickHouse limitation of single-table TTL policies.

```sql
CREATE TABLE telemetry_events (
  user_sub       String,      -- opaque sub claim from JWT (not raw UUID)
  service_name   String,
  event_type     String,
  occurred_at    DateTime,
  duration_ms    Float64,
  payload        String,      -- sanitized JSON, no PII
  retention_days UInt16       -- written at ingest from tier: 7 | 30 | 90
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (user_sub, event_type, occurred_at)
TTL occurred_at + toIntervalDay(retention_days);
```

### Additional Supabase tables (Phase B)

```sql
create table public.ingested_services (
  user_id      uuid references profiles(id) on delete cascade,
  service_name text not null,
  first_seen   timestamptz default now(),
  last_seen    timestamptz default now(),
  primary key (user_id, service_name)
);

create table public.telemetry_metadata (
  user_id           uuid primary key references profiles(id) on delete cascade,
  last_seen_version text,
  last_seen_at      timestamptz,
  needs_update      boolean default false
);

-- Long-lived API keys for REST API (Pro+)
create table public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade,
  key_hash    text not null unique,   -- SHA-256 only
  name        text,                   -- user-defined label
  last_used   timestamptz,
  created_at  timestamptz default now()
);
```

### Ingestion endpoint — `POST /api/telemetry/ingest`

```
Authorization: Bearer <license JWT>   (NOT the Supabase JWT)
Content-Type: application/json
```

Pipeline:

1. **Validate JWT** — ECDSA offline verify, check `exp`, `alg === 'ES256'`, `kid` known. **Hard reject `offline-pro` tier** with `403 { error: 'OFFLINE_PRO_NOT_SUPPORTED', message: 'Offline Pro users export to their own OTLP endpoint.' }`
2. **Extract** `service.name` + `diagnostic_agent.version` from `resourceAttributes`
3. **Services count** — upsert `(userId, service.name)`; count distinct. If > `maxServices` → `402 SERVICE_LIMIT_EXCEEDED`
4. **Validate events** — confirm events match `allowedEvents` in JWT (agent already filtered, but server validates as defense-in-depth)
5. **Version check** — if `diagnostic_agent.version` < `LATEST_AGENT_VERSION`, set `needsUpdate: true`
6. **Write to ClickHouse** — include `retention_days` per tier (individual: 7, pro: 30, team: 90)
7. **Forward to Grafana Cloud** — strip `Authorization`, inject Grafana API key server-side
8. **Return** `200 { received: true, needsUpdate: boolean, latestVersion: string }`

### Conversion email (Resend)

On the first `anomaly` event received for a user, send via Resend:

> _"A memory leak was detected in `my-api` — heap grew 45MB in 10 minutes. View on dashboard →"_

This is the primary conversion trigger. The CTA links to `/dashboard/anomalies` — if they're on Individual and the anomaly is in the 7-day window, they see it; if it rolled off, they see the upgrade prompt.

### Dashboard pages

- `/dashboard` — event timeline, p99 latency, top anomalies, version update banner
- `/dashboard/queries` — slowest queries, sanitized SQL, AI fix suggestions (Pro+)
- `/dashboard/anomalies` — memory/CPU/event-loop timeline
- `/dashboard/license` — tier, key rotate, billing portal

### Phase B API routes

```
GET  /api/telemetry/status                   → { needsUpdate, services[], lastSeenAt }

# REST API (Pro+, API key auth, CORS allowlisted)
GET  /api/v1/anomalies?service=&from=&to=
GET  /api/v1/queries?service=&orderBy=durationMs
GET  /api/v1/spans?traceId=
GET  /api/v1/services
GET  /api/v1/status

POST   /api/v1/webhooks                      → create webhook endpoint (Pro+)
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/:id

POST /api/ai/analyze-query                   → LLM fix suggestions (see below)
```

### AI fix suggestions — two modes

**Automatic (Pro / Team):** triggered by the dashboard when a query event arrives via OTLP ingestion. OpenAI call is made server-side, result cached by `sha256(sanitizedQuery)` in Upstash Redis (24h TTL).

**On-demand / manual (Offline Pro):** user visits `/account/analyze` in their browser, pastes a sanitized query copied from their own Jaeger/Grafana UI, clicks Analyze. Same endpoint, same OpenAI call, same cache — but initiated by a human browser session, not by the agent.

```
POST /api/ai/analyze-query
Authorization: Bearer <Supabase JWT>   ← browser session (works for ALL paid tiers)
Body: { sanitizedQuery: string, driverName?: string }

→ { aiSuggestions: string[] }
```

Rate limits: Individual = 0 (no access), Offline Pro = 20 calls/day, Pro = 100 calls/day, Team = 500 calls/day.
The container never makes this call — it is always browser-initiated.

**Webhooks:** HMAC-SHA256 signed, 3-attempt retry (1s → 4s → 16s). Built-in targets: Slack, PagerDuty, custom URL.

**Custom embedded UI (Team):** `@diagnostic-agent/ui` npm package — headless React components backed by REST API. API key scopes all data to account holder's partition.

---

## Limit Enforcement & Bypass Analysis

| Limit | Enforced at | Offline bypass? |
|---|---|---|
| Services monitored | Ingestion endpoint | No — offline = not sending |
| Event type gating | Agent (allowedEvents claim) + ingestion (defense-in-depth) | No — JWT forgery requires private key |
| Sampling rates | Agent (sampleRates claim) + ingestion validates | No — same |
| Trace retention | ClickHouse `retention_days` TTL | No — server-controlled |
| AI fix suggestions (automatic) | Server calls OpenAI via ingest pipeline | No — requires round-trip; Offline Pro skipped automatically |
| AI fix suggestions (on-demand) | Browser Supabase JWT → `/api/ai/analyze-query` | N/A — user-initiated from their own browser, not the container |
| JWT claims forgery | ECDSA signature | No — impossible without private key |

**Shared JWT attack:** buyer shares JWT with others. `sub` claim in JWT is an opaque hash. All ClickHouse writes are partitioned by `user_sub`. Shared token writes to the original buyer's partition — attacker sees someone else's data, not their own. Marginal benefit, high friction.

---

## Internet Requirements

| Capability | Internet? |
|---|---|
| Free — all local monitoring | ❌ Never |
| Offline Pro — local monitoring | ❌ Never |
| Offline Pro — ECDSA license validation | ❌ Never (bundled key) |
| Offline Pro — OTLP export | ❌ User's own endpoint |
| Offline Pro — license renewal | ✅ Once/year, from user's browser, not the container |
| Online tiers — license validation | ❌ Never (bundled key) |
| Online tiers — OTLP export to SaaS | ✅ Always |
| Online tiers — JWT renewal | ✅ Monthly (automatic via Stripe invoice event) |
| Online tiers — AI suggestions | ✅ Automatic via ingest |
| Offline Pro — AI suggestions | ✅ On-demand, from user's browser at /account/analyze |

Export failures are **silent and non-degrading** — agent emits `'error'` and continues. Local monitoring is never affected by network conditions.

### Enterprise / self-hosted (future phase)

For organizations that cannot send telemetry externally at all: ship the full SaaS backend as a Docker Compose / Helm chart. License validation still works offline (bundled key). Negotiated contract, not self-serve.

---

## Security Checklist

- [ ] Stripe webhook: always `stripe.webhooks.constructEvent()` before reading any payload
- [ ] License JWT: validate `exp`, `alg === 'ES256'` (reject `none`/`HS*`), `kid` exists, reject `offline-pro` at ingest
- [ ] Ingestion: rate-limit per `sub` claim (100 req/min) via Upstash Redis
- [ ] Private key: never logged, never in any response, rotated annually
- [ ] License key: store SHA-256 hash only — never plaintext
- [ ] API keys: store SHA-256 hash only — never plaintext
- [ ] JWT `sub`: opaque hash of userId — no raw identifiers in claims
- [ ] Supabase RLS: all tables have policies — no row accessible without auth context
- [ ] ClickHouse: `user_sub` partition key enforces cross-tenant isolation
- [ ] OTLP forward: strip `Authorization` header, inject Grafana key server-side
- [ ] CORS: `/api/v1/**` has an explicit allowlist for `@diagnostic-agent/ui` consumer domains
- [ ] CSP headers on dashboard: prevent XSS on displayed sanitized queries

---

## Deployment Topology

### Phase A — License Authority

```
Browser ──► Vercel (Next.js)
              ├─ /api/auth/**        → Supabase Auth
              ├─ /api/billing/**     → Stripe SDK
              └─ /api/license/**     → node:crypto (ECDSA sign)

Supabase:  profiles, license_keys
Stripe:    subscriptions + one-time payments + webhooks
Resend:    welcome emails, payment failure alerts
```

### Phase B — Telemetry SaaS (added on top of Phase A)

```
Browser        ──► Vercel (existing) + /dashboard/** + /api/telemetry/** + /api/v1/**
Agent (online) ──► POST /api/telemetry/ingest   (individual/pro/team JWT)
Agent (offline)──► user's own OTEL endpoint      (never contacts SaaS)
Custom UI      ──► GET  /api/v1/**               (API key, team tier, CORS allowlisted)

ClickHouse Cloud: telemetry_events (partitioned by user_sub)
Grafana Cloud:   raw OTLP trace storage
Upstash Redis:   rate limiting + AI response cache
OpenAI:          AI fix suggestions (Pro+)
Resend:          conversion anomaly emails + update notifications
```

---

## Environment Variables

### Phase A

| Variable | Where | Description |
|---|---|---|
| `PRIVATE_KEY` | Vercel (secret) | PEM ECDSA private key |
| `KEY_ID` | Vercel | Current key ID (e.g. `k1`) |
| `STRIPE_SECRET_KEY` | Vercel (secret) | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Vercel (secret) | Webhook signing secret |
| `STRIPE_OFFLINE_PRO_PRICE_ID` | Vercel | Annual one-time payment |
| `STRIPE_INDIVIDUAL_PRICE_ID` | Vercel | Monthly subscription |
| `STRIPE_PRO_PRICE_ID` | Vercel | Monthly subscription |
| `STRIPE_TEAM_PRICE_ID` | Vercel | Monthly subscription |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (secret) | Server-only admin key |
| `RESEND_API_KEY` | Vercel (secret) | Transactional email |

### Phase B (added later)

| Variable | Where | Description |
|---|---|---|
| `LATEST_AGENT_VERSION` | Vercel | Updated on each npm publish |
| `CLICKHOUSE_URL` | Vercel | ClickHouse Cloud connection URL |
| `CLICKHOUSE_API_KEY` | Vercel (secret) | ClickHouse Cloud API key |
| `GRAFANA_OTLP_URL` | Vercel | Grafana Cloud OTLP endpoint |
| `GRAFANA_API_KEY` | Vercel (secret) | Grafana Cloud API key |
| `OPENAI_API_KEY` | Vercel (secret) | AI fix suggestions |
| `UPSTASH_REDIS_URL` | Vercel (secret) | Rate limiting + AI cache |
| `UPSTASH_REDIS_TOKEN` | Vercel (secret) | Upstash auth token |
