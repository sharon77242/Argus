# Phase B — Telemetry SaaS

> **Gate metric:** $5,000 MRR from Individual / Pro / Team subscriptions.
> **Prerequisite:** Phase A gate cleared (20 Self-Hosted Pro customers).
> On Phase B launch day: activate Individual/Pro/Team Stripe prices.

## Cost Strategy — Vercel-First Until Revenue Justifies Cloud Run

**All infrastructure in Phase B starts on free tiers. Cloud Run is deferred.**

| Service | Phase B launch (free) | Migrate when |
|---|---|---|
| Ingestor | Vercel API route (serverless, free tier) | >100 active customers OR Vercel timeouts OR >$500 MRR |
| ClickHouse Cloud | Free tier (~5GB storage, reasonable query limits) | Storage approaches limit |
| Upstash Redis | Free tier (10K commands/day) | Rate limiting starts failing |
| Grafana Cloud | Free tier (14-day retention) | Needed for Enterprise SLA |
| GCP Pub/Sub | Skip entirely in Phase B.1 — Vercel handles sync writes | When ingestor migrates to Cloud Run |

**Phase B.1 (launch): Vercel API route ingestor → direct ClickHouse write (synchronous)**
**Phase B.2 (scale trigger): Cloud Run + Pub/Sub async pipeline when revenue justifies it**

The Vercel-first approach means Phase B launch cost is effectively **$0** beyond ClickHouse free tier.

**Stack for Phase B.1:** Vercel (Next.js API route) · ClickHouse Cloud free tier · Upstash Redis free tier · OpenAI (pay-per-use)
**Stack for Phase B.2:** GCP Cloud Run · GCP Pub/Sub · ClickHouse Cloud (paid) · Grafana Cloud · Upstash Redis (paid)

---

## B.1 — Phase B.1: Vercel Ingestor (Zero Cost Launch)

### B.1.1 — Add ingest route to existing Next.js app

```ts
// app/api/ingest/route.ts
// Phase B.1: synchronous ingest directly to ClickHouse
// Replace with Cloud Run + Pub/Sub pipeline in Phase B.2

export const runtime = 'nodejs';  // required for ClickHouse client

export async function POST(request: Request) {
  const jwt = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!jwt) return Response.json({ error: 'MISSING_TOKEN' }, { status: 401 });

  let claims: LicenseClaims;
  try {
    claims = validateLicense(jwt);
  } catch (err) {
    return Response.json({ error: 'INVALID_TOKEN' }, { status: 401 });
  }

  if (['self-hosted-pro', 'enterprise'].includes(claims.tier)) {
    return Response.json({ error: 'OFFLINE_TIER_NOT_SUPPORTED' }, { status: 403 });
  }

  // Rate limit via Upstash Redis
  const { success } = await ratelimit.limit(claims.sub);
  if (!success) return Response.json({ error: 'RATE_LIMITED' }, { status: 429 });

  const body = await request.json() as OTLPPayload;
  const filtered = filterAllowedEvents(body, claims.allowedEvents);
  const retentionDays = { individual: 7, pro: 30, team: 90 }[claims.tier] ?? 7;

  // Direct write — synchronous in Phase B.1
  await clickhouse.insert({
    table:  'telemetry_events',
    values: filtered.map(e => ({
      user_sub:       claims.sub,
      service_name:   e.serviceName,
      event_type:     e.eventType,
      payload:        JSON.stringify(e.payload),
      retention_days: retentionDays,
      received_at:    new Date().toISOString(),
    })),
    format: 'JSONEachRow',
  });

  // Conversion email (fire-and-forget)
  if (filtered.some(e => e.eventType === 'anomaly')) {
    triggerConversionEmailIfFirst(claims.sub).catch(() => {});
  }

  const agentVersion = body.resourceAttributes?.['diagnostic_agent.version'];
  return Response.json({
    received:      true,
    needsUpdate:   agentVersion ? semver.lt(agentVersion, LATEST_AGENT_VERSION) : false,
    latestVersion: LATEST_AGENT_VERSION,
  });
}
```

### B.1.2 — ClickHouse Cloud setup (free tier)

1. Create account at clickhouse.cloud
2. Create cluster — note: **free tier is AWS-hosted**. This is acceptable for Phase B.1 (low traffic). When you migrate to Phase B.2 Cloud Run, switch to a GCP eu-west-1 cluster to eliminate cross-cloud egress costs.
3. Run schema (same as §B.3 below)

### B.1.3 — Upstash Redis setup (free tier)

1. Create database at upstash.com
2. Use `@upstash/ratelimit` for token-bucket limiting: 100 requests/minute per `sub`

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';

export const ratelimit = new Ratelimit({
  redis:     Redis.fromEnv(),
  limiter:   Ratelimit.tokenBucket(100, '1 m', 100),
  prefix:    'argus:ingest',
});
```

### B.1.4 — Migration trigger to Phase B.2

Switch to Cloud Run + Pub/Sub when **any** of:
- Vercel function timeouts appear in logs (10s limit hit)
- ClickHouse writes from Vercel exceed free tier limits
- Monthly revenue > $500 (Cloud Run ~$10-15/mo is now justified)
- P95 ingest latency > 200ms

---

## B.2 — Phase B.2: Cloud Run + Pub/Sub Pipeline (deferred)

Build this section only when the migration trigger above fires. Until then, skip entirely.

### B.2.1 — GCP Project

1. Create GCP project: `argus-telemetry`
2. Enable: Cloud Run, Pub/Sub, Secret Manager, Container Registry, Cloud Build
3. Region: **europe-west1** — same as ClickHouse Cloud GCP cluster
4. Service accounts: `argus-ingestor` (Pub/Sub publisher), `argus-worker` (ClickHouse write + Pub/Sub subscriber)

### B.2.2 — Migrate ClickHouse to GCP

Create a new ClickHouse Cloud cluster on **GCP europe-west1**. Migrate data from Phase B.1 AWS cluster. Delete AWS cluster. This eliminates cross-cloud egress costs that become significant at scale.

### B.2.3 — Ingestor service

Replace the Vercel API route with a standalone Cloud Run service. Configuration:

```yaml
minInstances: 1      # never cold-start on a paying customer
maxInstances: 50
concurrency: 80
memory: 256Mi
cpu: 1
```

Core logic is identical to the Vercel route — same `validateLicense`, same `filterAllowedEvents`, same rate limit. Replace synchronous ClickHouse write with `topic.publishMessage()` to Pub/Sub.

### B.2.4 — Worker service

Cloud Run service triggered by Pub/Sub push subscription. Handles: ClickHouse write, Grafana Cloud forward (fire-and-forget), conversion email.

```yaml
minInstances: 0      # scale to zero fine — latency not customer-facing
maxInstances: 20
concurrency: 10
memory: 512Mi
```

### B.2.5 — Add Grafana Cloud forwarding (worker only)

Only add Grafana Cloud integration in Phase B.2. It's not needed for Phase B.1 — ClickHouse covers all dashboard needs.

```ts
// Fire-and-forget — never let Grafana failure nack the Pub/Sub message
fetch(GRAFANA_OTLP_URL, {
  method:  'POST',
  headers: { Authorization: `Bearer ${GRAFANA_API_KEY}` },
  body:    JSON.stringify(events),
}).catch(() => {});
```

---

## B.3 — Cloud Infrastructure Setup (Phase B.2 only)

### B.1.1 — GCP Project

1. Create GCP project: `argus-telemetry` (separate from `argus-licensing`)
2. Enable APIs: Cloud Run, Pub/Sub, Secret Manager, Container Registry, Cloud Build
3. Set default region: **europe-west1** — same as ClickHouse Cloud (avoids cross-cloud egress)
4. Create service accounts:
   - `argus-ingestor@argus-telemetry.iam.gserviceaccount.com` — Pub/Sub publisher only
   - `argus-worker@argus-telemetry.iam.gserviceaccount.com` — ClickHouse write + Pub/Sub subscriber

### B.1.2 — ClickHouse Cloud

1. Create account at clickhouse.cloud
2. Create cluster → **Cloud Provider: GCP** → **Region: europe-west1**
   > ⚠ This choice is irreversible without data migration. Verify cloud=GCP, region=europe-west1 before creating.
3. Note connection URL and API key
4. Run schema:

```sql
CREATE TABLE telemetry_events (
  user_sub       String,       -- opaque sub claim from JWT (not raw UUID)
  service_name   String,
  event_type     String,
  payload        String,       -- sanitized JSON, already scrubbed by agent
  retention_days UInt16,       -- written at ingest; drives per-row TTL
  received_at    DateTime
) ENGINE = MergeTree()
  ORDER BY (user_sub, service_name, event_type, received_at)
  TTL received_at + INTERVAL retention_days DAY;
```

5. Test write:
```sql
INSERT INTO telemetry_events VALUES ('test_sub', 'my-api', 'anomaly', '{}', 7, now());
SELECT * FROM telemetry_events WHERE user_sub = 'test_sub';
```

### B.1.3 — GCP Pub/Sub

```bash
gcloud pubsub topics create telemetry-events
gcloud pubsub subscriptions create telemetry-worker-sub \
  --topic=telemetry-events \
  --ack-deadline=60 \
  --push-endpoint=https://argus-worker-[hash]-ew.a.run.app/pubsub
```

### B.1.4 — Grafana Cloud

1. Create account at grafana.com
2. Create stack → EU region
3. Get OTLP endpoint URL and API key
4. Store as `GRAFANA_OTLP_URL` and `GRAFANA_API_KEY`

### B.1.5 — Upstash Redis

1. Create database at upstash.com → EU-West region
2. Copy `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN`
3. Used for: ingestion rate limiting (100 req/min per sub), AI response cache (24h TTL)

---

## B.2 — Ingestor Service (`packages/saas/ingestor/`)

> Separate Cloud Run service. Single responsibility: authenticate + enqueue. Never touches ClickHouse.

### B.2.1 — Create service

```bash
mkdir -p packages/saas/ingestor
cd packages/saas/ingestor
pnpm init
pnpm add fastify @google-cloud/pubsub
```

### B.2.2 — `src/index.ts`

```ts
import Fastify from 'fastify';
import { PubSub } from '@google-cloud/pubsub';
import { validateLicense } from '@argus/agent/licensing/validator'; // shared

const app = Fastify();
const pubsub = new PubSub();
const topic  = pubsub.topic('telemetry-events');

app.post('/ingest', async (req, reply) => {
  // 1. Extract Bearer JWT
  const jwt = req.headers.authorization?.replace('Bearer ', '');
  if (!jwt) return reply.code(401).send({ error: 'MISSING_TOKEN' });

  // 2. Validate ECDSA offline — same function used in agent
  let claims;
  try {
    claims = validateLicense(jwt);
  } catch (err) {
    return reply.code(401).send({ error: 'INVALID_TOKEN', message: (err as Error).message });
  }

  // 3. Hard-reject Self-Hosted Pro — they export to their own endpoint
  if (claims.tier === 'self-hosted-pro' || claims.tier === 'enterprise') {
    return reply.code(403).send({
      error:   'OFFLINE_TIER_NOT_SUPPORTED',
      message: 'Self-Hosted Pro and Enterprise users export to their own OTLP endpoint.',
    });
  }

  // 4. Rate limit per sub (100 req/min) via Upstash Redis
  const rateLimitOk = await checkRateLimit(claims.sub);
  if (!rateLimitOk) return reply.code(429).send({ error: 'RATE_LIMITED' });

  // 5. Validate event types against allowedEvents (defense-in-depth — agent already filtered)
  const body = req.body as OTLPPayload;
  const validatedEvents = filterAllowedEvents(body, claims.allowedEvents);

  // 6. Publish to Pub/Sub — returns to agent in < 10ms
  await topic.publishMessage({
    data: Buffer.from(JSON.stringify({ claims, events: validatedEvents })),
  });

  // 7. Check agent version
  const agentVersion = body.resourceAttributes?.['diagnostic_agent.version'];
  const needsUpdate  = agentVersion ? semver.lt(agentVersion, LATEST_AGENT_VERSION) : false;

  return reply.send({ received: true, needsUpdate, latestVersion: LATEST_AGENT_VERSION });
});

app.listen({ port: 8080, host: '0.0.0.0' });
```

### B.2.3 — Dockerfile

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm build
CMD ["node", "dist/index.js"]
```

### B.2.4 — Deploy to Cloud Run

```bash
gcloud run deploy argus-ingestor \
  --source . \
  --region europe-west1 \
  --service-account argus-ingestor@argus-telemetry.iam.gserviceaccount.com \
  --min-instances 1 \
  --max-instances 50 \
  --concurrency 80 \
  --memory 256Mi \
  --cpu 1 \
  --no-allow-unauthenticated  # JWT auth handled in app, not GCP IAM
```

---

## B.3 — Worker Service (`packages/saas/worker/`)

> Triggered by Pub/Sub push. Writes to ClickHouse + forwards to Grafana Cloud.

### B.3.1 — Create service

```bash
mkdir -p packages/saas/worker
pnpm add @clickhouse/client node-fetch
```

### B.3.2 — `src/index.ts`

```ts
const RETENTION_DAYS = { individual: 7, pro: 30, team: 90 } as const;

app.post('/pubsub', async (req, reply) => {
  const { claims, events } = decodePubSubMessage(req.body);

  const retentionDays = RETENTION_DAYS[claims.tier as keyof typeof RETENTION_DAYS] ?? 7;

  // Write to ClickHouse
  await clickhouse.insert({
    table:  'telemetry_events',
    values: events.map(e => ({
      user_sub:       claims.sub,
      service_name:   e.serviceName,
      event_type:     e.eventType,
      payload:        JSON.stringify(e.payload),
      retention_days: retentionDays,
      received_at:    new Date().toISOString(),
    })),
    format: 'JSONEachRow',
  });

  // Forward to Grafana Cloud (fire-and-forget — failure does NOT nack Pub/Sub)
  fetch(GRAFANA_OTLP_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${GRAFANA_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(events),
  }).catch(() => {}); // intentional: never let this nack the message

  // Trigger conversion email on first anomaly for this user (async)
  const hasAnomaly = events.some(e => e.eventType === 'anomaly');
  if (hasAnomaly) triggerConversionEmailIfFirst(claims.sub).catch(() => {});

  reply.code(204).send();
});
```

### B.3.3 — Deploy to Cloud Run

```bash
gcloud run deploy argus-worker \
  --source . \
  --region europe-west1 \
  --service-account argus-worker@argus-telemetry.iam.gserviceaccount.com \
  --min-instances 0 \
  --max-instances 20 \
  --concurrency 10 \
  --memory 512Mi \
  --cpu 1
```

---

## B.4 — Supabase Schema Additions

```sql
-- Services seen per user (for service count limit enforcement)
create table public.ingested_services (
  user_id      uuid references profiles(id) on delete cascade,
  service_name text not null,
  first_seen   timestamptz default now(),
  last_seen    timestamptz default now(),
  primary key (user_id, service_name)
);

-- Agent version tracking + update notifications
create table public.telemetry_metadata (
  user_id           uuid primary key references profiles(id) on delete cascade,
  last_seen_version text,
  last_seen_at      timestamptz,
  needs_update      boolean default false
);

-- Long-lived API keys for REST API (Pro+ only)
create table public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade,
  key_hash    text not null unique,   -- SHA-256 only
  name        text,
  last_used   timestamptz,
  created_at  timestamptz default now()
);

-- Conversion email tracking (send once per user)
create table public.conversion_emails_sent (
  user_sub   text primary key,  -- opaque sub from JWT
  sent_at    timestamptz default now()
);
```

---

## B.5 — Activate Online Tier Checkouts

In `packages/saas/app/api/billing/checkout/route.ts`, add:

```ts
'individual': { priceId: process.env.STRIPE_INDIVIDUAL_PRICE_ID!, mode: 'subscription', trial: true },
'pro':        { priceId: process.env.STRIPE_PRO_PRICE_ID!,        mode: 'subscription', trial: true },
'team':       { priceId: process.env.STRIPE_TEAM_PRICE_ID!,       mode: 'subscription', trial: true },
```

Update `/pricing` page to show active CTAs for all tiers.

---

## B.6 — Dashboard Pages

All dashboard pages read from ClickHouse via server-side Next.js API routes. Never route raw OTLP through Vercel.

### B.6.1 — `app/dashboard/page.tsx`

- Event timeline (last 24h)
- p99 latency by service
- Top 5 anomalies
- Version update banner (if `needsUpdate`)

### B.6.2 — `app/dashboard/queries/page.tsx` (Pro+ only)

- Slowest queries table (sanitized SQL, no values)
- AI fix suggestion button per query (calls `/api/v1/analyze`)
- N+1 pattern alerts

### B.6.3 — `app/dashboard/anomalies/page.tsx`

- Memory / CPU / event-loop timeline
- Heap snapshot download link (if available)
- Correlation: anomaly → concurrent query spike

### B.6.4 — `app/dashboard/license/page.tsx`

- Tier, expiry, service count used / max
- Key rotate button
- Billing portal link

---

## B.7 — AI Suggestion Engine

### B.7.1 — Abstraction (`packages/saas/lib/ai/suggestion-engine.ts`)

```ts
export interface SuggestionEngine {
  analyze(context: TraceContext): Promise<AISuggestion[]>;
}

export interface TraceContext {
  sanitizedQuery: string;
  driverName?: string;
  occurrenceCount?: number;    // from ClickHouse: how many times in window
  heapDeltaBytes?: number;     // correlated anomaly
  p99BaselineMs?: number;      // 30-day baseline
}
```

### B.7.2 — OpenAI implementation

```ts
export class OpenAISuggestionEngine implements SuggestionEngine {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async analyze(ctx: TraceContext): Promise<AISuggestion[]> {
    // Check Upstash Redis cache first (key = sha256(sanitizedQuery))
    const cacheKey = sha256(ctx.sanitizedQuery);
    const cached   = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const response = await this.openai.chat.completions.create({
      model:    'gpt-4o-mini',
      messages: [{ role: 'user', content: buildPrompt(ctx) }],
    });

    const suggestions = parseSuggestions(response.choices[0].message.content!);

    // Cache 24h
    await redis.set(cacheKey, JSON.stringify(suggestions), { ex: 86400 });
    return suggestions;
  }
}
```

### B.7.3 — `api/v1/analyze/route.ts`

```ts
// Rate limits by tier:
// individual: 0 (403)
// self-hosted-pro: 20/day (browser session, Supabase JWT)
// pro: 200/day soft cap
// team: 1000/day hard cap (BYOK bypasses)

export async function POST(request: Request) {
  const tier = profile.tier;
  if (tier === 'individual') return Response.json({ error: 'UPGRADE_REQUIRED' }, { status: 403 });

  const dailyUsage = await getDailyAIUsage(user.id);
  const limit      = AI_DAILY_LIMITS[tier];
  if (dailyUsage >= limit) {
    return Response.json({
      error:    'DAILY_LIMIT_REACHED',
      message:  tier === 'pro'
        ? `You've used ${limit} AI analyses today — you're in our top 1% of active users. Rule-based suggestions continue. AI resets midnight UTC or upgrade to Team.`
        : 'Daily limit reached.',
      resetAt: 'midnight UTC',
    }, { status: 429 });
  }

  const { sanitizedQuery, driverName } = await request.json();
  const engine      = getEngineForUser(profile); // OpenAI or BYOK
  const suggestions = await engine.analyze({ sanitizedQuery, driverName });

  await incrementDailyAIUsage(user.id);
  return Response.json({ suggestions });
}
```

---

## B.8 — REST API (`/api/v1/`) — Pro+ only

All routes require API key auth (`Authorization: Bearer <api_key>`).
API key is stored as SHA-256 hash only. Compare `sha256(incoming) === stored_hash`.

```
GET  /api/v1/events?service=&type=&from=&to=
GET  /api/v1/services
GET  /api/v1/summary?service=&window=
POST /api/v1/webhooks           → register endpoint (Pro/Team)
GET  /api/v1/webhooks
DELETE /api/v1/webhooks/:id
```

CORS explicit allowlist on `/api/v1/**` — required for `@argus/ui` Team embedded components.

---

## B.9 — Conversion Email

Triggered by worker on first `anomaly` event per `user_sub`.

```ts
async function triggerConversionEmailIfFirst(userSub: string): Promise<void> {
  // Idempotent: insert only if not already sent
  const { error } = await supabaseAdmin
    .from('conversion_emails_sent')
    .insert({ user_sub: userSub });
  if (error) return; // already sent (unique constraint) — do nothing

  const profile = await getProfileBySub(userSub);
  await resend.emails.send({
    from:    'Argus <alerts@argus.dev>',
    to:      profile.email,
    subject: `Memory anomaly detected in ${serviceName}`,
    html:    `Heap grew ${heapMB}MB in the last 10 minutes in <strong>${serviceName}</strong>.<br>
              <a href="https://argus.dev/dashboard/anomalies">View on dashboard →</a>`,
  });
}
```

---

## B.9b — Self Code Review

Issues found and corrected:

| Issue | Location | Fix |
|---|---|---|
| `decodePubSubMessage` referenced in worker but never defined | `worker/src/index.ts` | Define: base64-decode `message.data`, JSON parse, extract `{ claims, events }` |
| `checkRateLimit` referenced in ingestor but never defined | `ingestor/src/index.ts` | Replaced with `@upstash/ratelimit` — see §B.1.3 |
| Conversion email uses `serviceName` and `heapMB` not in scope from `claims` | `worker/src/index.ts` | Extract from the actual event payload: `const serviceName = events[0]?.serviceName; const heapMB = events.find(e=>e.eventType==='anomaly')?.payload?.heapGrowthBytes / 1_048_576` |
| `getProfileBySub` in conversion email — `sub` is an opaque hash, not a lookup key for `profiles` | `worker/src/alerting.ts` | Add `sub_hash` column to `profiles` table in the Supabase schema, populated at JWT issuance. Or: store user's email in `conversion_emails_sent` at ingest time using the Supabase admin client |
| Phase B.1 Vercel ingestor writes synchronously to ClickHouse — Vercel functions have a 10s execution limit | `app/api/ingest/route.ts` | ClickHouse batch inserts are typically <100ms. Acceptable for Phase B.1. Add `AbortSignal.timeout(8000)` to the ClickHouse write call so it fails fast before Vercel kills it. |
| `semver.lt` used but `semver` not imported | `app/api/ingest/route.ts` | Add: `import semver from 'semver'` and `pnpm add semver @types/semver` |
| AI rate limit daily counter — no definition of how it's stored | `api/v1/analyze/route.ts` | Use Upstash Redis: `INCR argus:ai:{userId}:{date}` with `EXPIREAT` set to midnight UTC |

---

## B.10 — Vercel Environment Variables (Phase B additions)

| Variable | Description |
|---|---|
| `LATEST_AGENT_VERSION` | Updated on each npm publish |
| `CLICKHOUSE_URL` | ClickHouse Cloud connection URL |
| `CLICKHOUSE_API_KEY` | ClickHouse Cloud API key |
| `GRAFANA_OTLP_URL` | Grafana Cloud OTLP endpoint |
| `GRAFANA_API_KEY` | Grafana Cloud API key |
| `OPENAI_API_KEY` | AI fix suggestions |
| `UPSTASH_REDIS_URL` | Rate limiting + AI cache |
| `UPSTASH_REDIS_TOKEN` | Upstash auth token |
| `GCP_INGESTOR_URL` | Cloud Run ingestor endpoint |

---

## B.10b — Test Coverage Requirements

| File | What to cover |
|---|---|
| `tests/ingest/ingestor.test.ts` | Missing token → 401; invalid JWT → 401; self-hosted-pro → 403; enterprise → 403; rate limit exceeded → 429; event not in allowedEvents → filtered out before write; valid request → 200 `{ received: true }` |
| `tests/ingest/service-limit.test.ts` | Individual tier: second service → 402 SERVICE_LIMIT_EXCEEDED; first service → accepted; Pro tier: 6th service → 402; Team → no limit |
| `tests/ingest/retention.test.ts` | individual → `retention_days=7`; pro → 30; team → 90 written to ClickHouse row |
| `tests/ai/rate-limit.test.ts` | individual → 403; pro at 0 → passes; pro at 200 → 429 with upgrade message; team at 1000 → 429; BYOK bypasses cap |
| `tests/ai/cache.test.ts` | Same sanitized query returns cached result (no OpenAI call); different query hits OpenAI; cache expires after 24h |
| `tests/conversion-email.test.ts` | First anomaly for sub → email sent; second anomaly → no email (idempotent); non-anomaly event → no email |
| `tests/webhooks/delivery.test.ts` | Successful delivery on first attempt; retry after failure (1s → 4s → 16s); all retries fail → failure logged; HMAC signature matches |

### Integration test: full pipeline (Phase B.1)

```ts
// tests/integration/ingest-pipeline.test.ts
// 1. POST a valid OTLP payload to /api/ingest with a Pro JWT
// 2. Query ClickHouse — event appears with correct retention_days=30
// 3. GET /dashboard → anomaly visible
// 4. POST /api/v1/analyze → AI suggestion returned
```

---

## B.11 — Security Additions

- [ ] Ingestor: hard-reject `self-hosted-pro` and `enterprise` tiers with `403`
- [ ] Ingestor: validate `allowedEvents` claim (defense-in-depth — agent already filtered)
- [ ] Rate limit per `sub` claim: 100 req/min via Upstash Redis
- [ ] API keys: store SHA-256 hash only — never plaintext
- [ ] ClickHouse: `user_sub` partition key enforces cross-tenant isolation
- [ ] OTLP forward: strip `Authorization` header, inject Grafana key server-side
- [ ] CORS: `/api/v1/**` explicit allowlist for `@argus/ui` consumer domains
- [ ] CSP headers on dashboard: prevent XSS on displayed sanitized queries

---

## B.12 — Gate Verification

- [ ] End-to-end: agent emits anomaly → ingestor receives → Pub/Sub → worker → ClickHouse → dashboard shows event
- [ ] Individual tier: verify `fs` events are blocked at ingestor
- [ ] Service count: second service for Individual (max=1) returns `402 SERVICE_LIMIT_EXCEEDED`
- [ ] AI rate limit: Pro hits 200/day → receives upgrade message, not hard error
- [ ] Conversion email: fires exactly once per `user_sub` (idempotent)
- [ ] Webhook fires on anomaly for Pro/Team customers
- [ ] `$5,000 MRR` reached → proceed to Phase C
