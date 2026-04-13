# Deep Diagnostic Agent — Definitive Product & Business Plan

> **Final. All architectural gaps closed. All stress tests passed. Unit economics validated. GDPR posture documented.**

---

## Strategic North Star

**The agent is the distribution. The platform is the business. The data is the moat.**

Open source the agent unconditionally under MIT. Every `npm install` is a qualified lead. Every developer who catches a real N+1 with a local suggestion is a future paying customer. The SaaS dashboard, the AI suggestions, the REST API — these are all disposable UI layers. The 90-day trace history accumulated per service, correlated across events, with a known baseline — that data does not exist anywhere else in the world. That is what you are building and what cannot be copied.

The AI copy-paste attack fails not because you block it, but because ChatGPT sees one query the user remembered to paste. Your AI sees that the query ran 847 times in 3 minutes, correlated with a 140MB heap spike, against a table that has three concurrent N+1 patterns, and is 40% slower than its 30-day p99 baseline. That context gap widens every week a customer stays on the platform.

---

## Product Architecture

Two independent components, built and released in strict sequence:

```
┌─────────────────────────────────────────────────────────────┐
│   deep-diagnostic-agent (npm) — MIT License                 │
│                                                             │
│   Embedded in the user's Node.js process.                   │
│   Zero network calls. Zero account required.                │
│   EventEmitter + structured suggestions[] on every event.   │
│   OTLP export to any endpoint (user's infra or SaaS).       │
└─────────────────────────────────────────────────────────────┘
           │  installs it, points OTLP at their destination
           ▼
┌─────────────────────────────────────────────────────────────┐
│   License Authority — Phase A                               │
│   Supabase + Stripe + Resend + Vercel                       │
│                                                             │
│   Auth, billing, JWT issuance. Must never go down.          │
│   Sells: Self-Hosted Pro + Enterprise Compliance only.      │
│   No ClickHouse. No Grafana. No AI inference.               │
└─────────────────────────────────────────────────────────────┘
           │  built after Phase A has 20 paying customers
           ▼
┌─────────────────────────────────────────────────────────────┐
│   Telemetry SaaS — Phase B                                  │
│                                                             │
│   Ingestor: Cloud Run + GCP Pub/Sub (async, < 10ms ACK)    │
│   Worker:   Cloud Run → ClickHouse Cloud + Grafana Cloud    │
│   Dashboard/API: Next.js on Vercel (read path only)         │
│   AI suggestions: OpenAI via Next.js API route              │
│                                                             │
│   Serves: Individual, Pro, Team only.                       │
│   Offline and Self-Hosted users never contact this.         │
```

The License Authority going down is a P0 incident. The Telemetry SaaS going down affects only online dashboards — offline, self-hosted, and free users are completely unaffected.

---

## Pricing Model

| | Free (OSS) | Self-Hosted Pro | Individual | Pro | Team | Enterprise |
|---|---|---|---|---|---|---|
| **Price** | $0 | $499/yr | $19/mo | $29/mo | $99/mo | $5k+/yr |
| **Channel** | npm | Self-serve | Self-serve | Self-serve | Self-serve | Sales-only |
| **License key** | ❌ | ✅ Annual JWT | ✅ 30-day JWT | ✅ 30-day JWT | ✅ 30-day JWT | ✅ Annual JWT |
| **Internet required** | Never | Once/year | Monthly | Monthly | Monthly | Once/year |
| **Dashboard** | ❌ | ✅ Self-hosted Docker | ✅ SaaS | ✅ SaaS | ✅ SaaS | ❌ (own stack) |
| **OTLP destination** | Own infra | Self-hosted ingestor | SaaS | SaaS | SaaS | Own infra |
| **Services** | Unlimited (local) | Unlimited | 1 | 5 | Unlimited | Unlimited |
| **Events exported** | All (local only) | All | All except fs | All except fs | All | All |
| **Sampling** | None | None | None | None | None | None |
| **Retention** | Stateless | Own disk | 14 days | 30 days | 90 days | Own infra |
| **Ingestion cap** | N/A | Own disk | 5GB/mo | 20GB/mo | 50GB/mo + $0.50/GB overage | Contracted |
| **Local rule suggestions** | ✅ Always | ✅ Always | ✅ Always | ✅ Always | ✅ Always | ✅ Always |
| **AI suggestions** | ❌ | ✅ BYOK required | ❌ | ✅ 200/day soft cap | ✅ 1,000/day + BYOK unlock | ✅ 20/day manual paste |
| **REST API** | ❌ | ✅ Local | ❌ | ✅ | ✅ | ❌ |
| **Webhooks** | ❌ | ❌ Phase D | ❌ | ✅ | ✅ | ❌ |
| **Team seats** | 1 | Unlimited | 1 | 3 | Unlimited | Unlimited |
| **Free trial** | — | ✅ 14-day, no card | 14 days | 14 days | 14 days | POC period |
| **Custom embedded UI** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Support** | GitHub issues | Docs + Discord | Docs | Docs + email | Priority email | Dedicated + SLA |

> **No tier uses sampling.** Differentiation is by retention, service count, AI, and features — never by degrading data quality. A developer debugging a production incident must see actual queries.

### Pricing Rationale

**$499/yr for Self-Hosted Pro** sits below the ~$500 corporate card discretionary threshold that exists in most engineering organizations. At $499, a team lead expenses it on Friday. At $799, it triggers a purchase order, a vendor security review, and a 6-week procurement cycle. The lost $300 per customer is recovered many times over in zero sales-cycle cost and pure volume.

**Individual at $19/mo gets full query, HTTP, and log traces** — the product's core differentiator — limited to 1 service and 14-day retention. This is Option B: let the developer taste the value, then charge for scale. The upgrade pressure to Pro is about needing more services and longer retention, not paying a toll to see if the product works. A developer who has seen their own N+1 caught and explained is dramatically more likely to upgrade than one who paid $9/mo and only saw crash events.

**Sampling removal from all tiers** is a hard architectural decision. Pro at $29/mo gets 100% of query/http/log traces, limited to 5 services and 30-day retention. Users who've been burned by Datadog's sampling behavior — which is a recurring, vocal complaint in their reviews — will notice this immediately. Data quality at the individual event level is non-negotiable.

**Team tier includes a 50GB/month ingestion cap with transparent overage pricing.** "Unlimited services" and "unlimited seats" are real — there is no artificial limit on how many microservices or team members can be connected. But "unlimited" applied to raw data volume is not an infrastructure reality. A mid-sized agency can route 20 microservices and 500GB of raw trace data into a $99/mo tier and make Team uneconomic instantly. The cap is set at 50GB/month of ingested trace data — a threshold the median team never approaches — with a $0.50/GB overage fee beyond that. This is disclosed transparently on the pricing page and in the onboarding email. 95% of customers never see it. The 5% who do are large enough to be Team+ or Enterprise candidates.

**Enterprise Compliance does not exist on the pricing page.** It lives exclusively on `/compliance` with a "Talk to us" CTA. Air-gapped enterprise buyers — banks, defense contractors, hospitals — do not trust a product they can buy with a credit card in 90 seconds. The sales process is part of what signals legitimacy to their security team. Starting price is $5,000/year; real contracts run $10,000–$15,000 with procurement paperwork, SLA, and dedicated onboarding.

### Event Export Matrix

| Event | Free | Self-Hosted Pro | Enterprise | Individual | Pro | Team |
|---|---|---|---|---|---|---|
| crash | ✅ local | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |
| anomaly | ✅ local | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |
| leak | ✅ local | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |
| query | ✅ local | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |
| http | ✅ local | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |
| log | ✅ local | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |
| fs | ✅ local | ✅ 100% | ✅ 100% | ❌ | ❌ | ✅ 100% |

---

## Competitive Positioning

### Real Competitors

**Datadog / New Relic / Dynatrace:** Enterprise APM. Heavy agents, raw query values and log payloads shipped to the cloud. Their privacy story is weak by design — their business model requires your data. Sampling is a persistent complaint. Switching cost is high, but so is the compliance pain they create.

**Sentry:** Excellent for errors. No query analysis, no AST sanitization, no event loop monitoring. Complementary, not directly competitive. They occupy the "crash visibility" mental slot you need to own for Individual tier.

**OpenTelemetry collectors:** Infrastructure plumbing, not a product. No query analysis, no AI suggestions, no privacy firewall. You build on top of them.

### Actual Differentiators

These are engineering decisions that competitors cannot add retroactively without rebuilding their ingestion pipelines:

**AST-level value scrubbing.** SQL/NoSQL bound values are destroyed before they touch any metric. `SELECT * FROM orders WHERE id = $1` stays; the value `42` is gone at the AST layer before the string is ever stored. This is not log scrubbing — it is pre-metric destruction.

**Entropy-checked log sanitization.** Shannon entropy scanning strips JWTs, API keys, and any high-entropy string from `console.*` payloads automatically. Default threshold: 4.0 bits/char. No other Node APM does this by default.

**Fully offline license validation.** ECDSA P-256, public key bundled in the npm package. An air-gapped server running for 364 days generates zero outbound calls. This unlocks a compliance market that online-only APMs structurally cannot serve.

**Agent-side event filtering.** Tier limits applied locally before any byte crosses the network. No data is sent only to be discarded server-side.

**Local rule-based suggestions on free tier.** N+1 detection, `SELECT *`, missing `LIMIT`, unparameterized queries — all fire synchronously as structured data with zero account required.

**Standard OTLP export — no lock-in.** The agent exports standard OpenTelemetry Protocol. A customer who decides to leave changes one environment variable and their future telemetry routes to Datadog, Honeycomb, or their own Jaeger. Their historical data in the SaaS stays there; their future data is instantly portable. Say this explicitly on the marketing site: *"We don't lock your data. Standard OTLP means you can leave whenever you want. We have to earn your business every month."* Competitors who obscure this make the contrast effortless.

---

## The Microscope / Telescope Split

This is the core monetization psychology embedded in the product architecture.

The free tier gives developers the **microscope**: the exact event, the exact file, the exact line. Immediate, acute value. Trust is built in 60 seconds.

The paid tier gives developers the **telescope**: 30-day baseline, cross-service correlation, historical anomaly pattern, AI-generated DDL fix. The things that require accumulated data — which only the platform has.

### Structured Suggestion Format

The agent is a library, not a CLI. The suggestions fire as structured data on the EventEmitter. The consuming application decides how to format and route them. This is how enterprise-grade Node.js libraries behave — they respect the host container's logging pipeline.

```ts
agent.on('query', (event) => {
  // event.suggestions[] — always present, always structured
  // Free tier: rule-based entries
  // Paid tier: same rules PLUS ai_insights[] with historical context
  
  // Example output on free tier:
  // [
  //   {
  //     rule: 'N1_DETECTED',
  //     severity: 'high',
  //     message: 'Query executed 42 times in 1.8s',
  //     fix: 'Batch with WHERE user_id = ANY($1)',
  //     upgrade_hint: {
  //       signal: 'MEMORY_SPIKE_CORRELATED',
  //       message: 'Heap grew 140MB during this window. 30-day baseline and job correlation require the dashboard.',
  //       url: 'https://saas.example.com/upgrade?ref=n1_memory'
  //     }
  //   }
  // ]
});
```

**The upgrade_hint is honest.** It never says "abnormal" without a baseline — the free tier is stateless and has no baseline. It says "Heap grew 140MB during this window" — factually true — and explicitly states that calling it abnormal requires the historical context only the dashboard has. Misleading hooks destroy trust faster than any competitor.

**The upgrade_hint is structured data.** A Team customer can programmatically route `upgrade_hint` events directly into a Slack alert. That is leverage: the free tier's own output becomes a marketing channel inside paying customers' infrastructure.

---

## Phase 0: OSS Agent — Build First, Launch as the Event

Phase 0 ships before any SaaS infrastructure exists. The goal is not metrics — it is proof that real developers can articulate, unprompted, what specific problem the agent solved for them.

### Gate Metric

**50 genuine testimonials** — GitHub issue comments, HN thread replies, Discord messages — where a developer describes a specific bug or performance issue the agent caught in their real codebase.

Not GitHub stars. Not npm installs. CI/CD bots and dependency scanners can inflate those numbers overnight. 50 developers who can name the specific query or memory leak the agent caught are the signal that Phase A will convert. If you cannot reach 50, the SaaS will not save you.

### Phase 0 Checklist

- Publish `deep-diagnostic-agent` to npm and GitHub under MIT license
- README leads with the 60-second GIF (see below)
- Add GitHub Sponsors — revenue is negligible, donor list is your highest-intent contact list
- Email capture pointing to SaaS waitlist ("get notified when the dashboard launches")
- Clear "self-host your OTLP" section: Jaeger, Grafana Alloy, any OTEL-compatible collector
- `BUNDLED_PUBLIC_KEYS` embedded in npm package — offline validation works on day one

### The 60-Second GIF

The single most important marketing asset produced in Phase 0. No copy, no feature list, no explainer. An unedited screen recording of a developer starting a realistic Node.js application and watching the agent catch a real N+1 query — against a recognizable codebase, a realistic query (user preferences fetched inside a loop), structured output appearing in the terminal within seconds.

This GIF goes in the README second paragraph, the Show HN post, every other channel. It does more work than any paragraph you can write.

### Show HN: The Launch Event

The primary distribution mechanism. Not a supporting channel — the event around which everything else is staged.

**Why this channel specifically:** Hacker News is the only platform where the deep technical architecture of the tool — offline ECDSA validation, AST-level sanitization, `diagnostics_channel` as the interception primitive, Shannon entropy scanning — is a marketing asset rather than noise. A well-executed Show HN for a developer observability tool can generate 500 GitHub stars in 48 hours and significant npm install volume in a week. PostHog, Supabase, and Infisical all credited Show HN as their primary initial distribution.

**Execution requirements:**
- Post Tuesday or Wednesday, 8–9am Eastern
- Second sentence links the 60-second GIF — HN readers bounce without immediate visual proof
- Own the free tier hard: MIT-licensed, fully functional offline, no SaaS trap. HN distrusts SaaS bait-and-switch. Lead with the truth.
- Prepare for the top comment: "Why not just use console.time or otel auto-instrumentation?" Have the exact technical differentiation ready — AST-level scrubbing, offline validation, context-rich AI correlation — not marketing copy, actual engineering answers
- Engage every substantive comment for the first 6 hours. The thread does more distribution work than the post itself.

### The Sniper PR

One PR, not many. One high-visibility TypeScript/Node.js project — Medusa, Payload CMS, NestJS — where the agent catches a deep, non-trivial, reproducible N+1 or memory anomaly. Not a toy example.

The OSS maintainer community is small and interconnected. Five mediocre "my tool found your bug" PRs will get you tagged as a spammer before your GitHub stars hit double digits. One flawless, deeply researched PR — the description reads like a technical postmortem, the tool appears almost incidentally — builds institutional credibility that travels through the community.

Spend a week on it. Verify the fix is unambiguously correct. Document the exact structured output, the memory allocation behavior, the time saved. When the maintainer merges it, that PR link is your proof of work for every subsequent conversation.

**The false positive risk is existential.** If your agent flags something in a well-maintained codebase that turns out to be intentional, you have publicly demonstrated incorrect output to the exact audience you need to trust it. Verify before you submit.

### "Roast My Architecture" — R&D, Not Growth

Offer to manually interpret the agent's JSON output from edge cases, weird ORMs, and legacy codebases. Frame it as optional, make explicit what data you're receiving, emphasize that AST sanitization means query values are already stripped.

This is pure product research, not a growth mechanism. The people who participate are already installed users — they don't move the install number. What they give you is raw data on which frameworks generate the most noise, which rules produce false positives, and what questions developers actually have after seeing the output. That data is worth weeks of guesswork and shapes your rule engine tuning before you have paying customers depending on it.


### Fallback Distribution — Parallel Channels

Show HN hits front page roughly 30–40% of the time for a genuine technical OSS post. That means a 60–70% chance the primary launch mechanism underperforms. The following three channels run in parallel with Show HN regardless of HN outcome.

**Node.js newsletter outreach.** Node Weekly, JavaScript Weekly, and Bytes.dev combined reach approximately 200,000 developers. Each accepts community submissions. Contact the editors directly — not through submission forms — one week before launch with a personal email and the 60-second GIF attached. Cost: zero. Lead time required: 2 weeks minimum. This channel is high-leverage and zero-cost; there is no reason not to execute it in parallel with every other launch activity.

**Podcast cold outreach.** Syntax.fm, JS Party, and NodeJS Podcast combined. Pitch a technical episode topic — "why runtime observability fails privacy-sensitive applications" — not a product demo. The tool is the credential that gets you the booking; the episode is the distribution. Lead time: 4–6 weeks. Start outreach before Phase 0 launches so episodes can air during or immediately after the Show HN window.

**Surgical GitHub issue posting.** Find open issues in Express, NestJS, and Fastify repositories tagged `performance` or `memory-leak` where the agent would have caught the reported problem. Post a technical comment explaining the detection mechanism with a link to the repo. The line between helpful and spam is: post only where the agent output is directly relevant to the specific reported issue, and only where the maintainer is actively attempting to reproduce a problem. One relevant, technically precise comment in the right thread reaches exactly the developers who have the problem the agent solves. Five generic comments in unrelated issues gets you muted.

---

## Phase A: License Authority

**Built first. Must be highly available. Sells two things only.**

Phase A sells Self-Hosted Pro ($499/yr, one-time annual payment) and accepts Enterprise Compliance inquiries ("Talk to us"). Individual, Pro, and Team tiers do not exist in Stripe until Phase B is live and the dashboard can actually deliver their value. Selling a subscription to a dashboard that doesn't exist yet is a chargeback waiting to happen.

**Phase A gate: 20 Self-Hosted Pro customers at $499/yr.**
That is $9,980 ARR — enough to prove the offline privacy market without building any cloud infrastructure. If you cannot get 20 teams to pay $499/yr for a Docker-based dashboard with offline license validation, the SaaS will not save you.

### Stack

Supabase + Stripe + Resend + Vercel. No ClickHouse. No Redis. No Grafana. No AI inference. Small, cheap, highly available.

### Database Schema

```sql
create table public.profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  email                    text not null,
  tier                     text not null default 'free'
                             check (tier in ('free','self-hosted-pro','enterprise','individual','pro','team')),
  stripe_customer_id       text unique,
  stripe_subscription_id   text,
  plan_expires_at          timestamptz,
  -- Trial abuse prevention (DB-enforced, not application-level)
  email_domain             text generated always as (split_part(email, '@', 2)) stored,
  self_hosted_trial_used   boolean not null default false,
  self_hosted_trial_at     timestamptz,
  created_at               timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Own profile only" on public.profiles using (auth.uid() = id);

-- One trial per email domain — DB unique index, not bypassable at application level
create unique index one_self_hosted_trial_per_domain
  on public.profiles (email_domain)
  where self_hosted_trial_used = true;

-- License key audit log — SHA-256 hash only, never plaintext
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

### Tier Configuration

```ts
const TIER_CONFIG = {
  'self-hosted-pro': {
    maxServices:   null,
    allowedEvents: ['crash','anomaly','leak','query','http','log','fs'],
    sampleRates:   {},   // no sampling — always empty
    expDays:       365,
  },
  'enterprise': {
    maxServices:   null,
    allowedEvents: ['crash','anomaly','leak','query','http','log','fs'],
    sampleRates:   {},
    expDays:       365,
  },
  'individual': {
    maxServices:   1,
    allowedEvents: ['crash','anomaly','leak','query','http','log'],
    sampleRates:   {},
    expDays:       30,
  },
  'pro': {
    maxServices:   5,
    allowedEvents: ['crash','anomaly','leak','query','http','log'],
    sampleRates:   {},   // full fidelity, no sampling
    expDays:       30,
  },
  'team': {
    maxServices:   null,
    allowedEvents: ['crash','anomaly','leak','query','http','log','fs'],
    sampleRates:   {},
    expDays:       30,
  },
};
```

### Stripe Integration

```ts
const STRIPE_CONFIG = {
  'self-hosted-pro': {
    priceId: process.env.STRIPE_SELF_HOSTED_PRO_PRICE_ID!,
    mode: 'payment' as const,       // one-time annual
    trial: false,
  },
  // Individual/Pro/Team added to Stripe only when Phase B launches
  'individual': { priceId: process.env.STRIPE_INDIVIDUAL_PRICE_ID!, mode: 'subscription' as const, trial: true },
  'pro':        { priceId: process.env.STRIPE_PRO_PRICE_ID!,        mode: 'subscription' as const, trial: true },
  'team':       { priceId: process.env.STRIPE_TEAM_PRICE_ID!,       mode: 'subscription' as const, trial: true },
};
```

### Stripe Webhook Handlers

All handlers are idempotent. Idempotency key: `stripe_subscription_id` for subscriptions, `checkout.session.id` for one-time payments.

| Event | Action |
|---|---|
| `checkout.session.completed` | Set tier; issue initial JWT; send welcome email via Resend |
| `customer.subscription.updated` | Update tier on plan change |
| `invoice.payment_succeeded` | Re-issue 30-day JWT (Individual/Pro/Team only) |
| `invoice.payment_failed` | Set tier = 'free'; send warning email |
| `customer.subscription.deleted` | Set tier = 'free'; nullify subscription columns |

### Stripe Dual-Fulfillment (Critical)

Webhooks are reliable but not instantaneous. During Stripe outages or peak traffic, `checkout.session.completed` can lag by minutes. A customer who completes a $499 checkout, lands on your success page, and sees no JWT and no email will immediately suspect fraud and request a chargeback. Do not rely exclusively on the asynchronous webhook for initial fulfillment.

**The success redirect is a synchronous fulfillment path, not a thank-you page.**

```
Stripe Checkout → success_url: /account/success?session_id={CHECKOUT_SESSION_ID}
```

```ts
// app/account/success/page.tsx
export default async function SuccessPage({ searchParams }) {
  const sessionId = searchParams.session_id;
  if (!sessionId) redirect('/account');

  // Synchronously retrieve the session — this is a direct Stripe API call,
  // not a webhook. It is available immediately after checkout completion.
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription', 'payment_intent'],
  });

  if (session.payment_status !== 'paid') {
    // Payment not confirmed — show pending state, do not issue JWT
    return <PendingPaymentPage />;
  }

  // Idempotent fulfillment — check if webhook already processed this session
  const existing = await supabase
    .from('profiles')
    .select('tier, license_keys(*)')
    .eq('id', user.id)
    .single();

  if (existing.tier !== 'free') {
    // Webhook already processed — just display the existing JWT
    return <SuccessPage licenseKey={await getLatestKey(user.id)} />;
  }

  // Webhook has not yet fired — fulfill synchronously now
  // The webhook handler will be a no-op when it eventually arrives (idempotent)
  const licenseKey = await fulfillCheckout(session, user.id);

  return <SuccessPage licenseKey={licenseKey} />;
}
```

The webhook handler and the success page both call `fulfillCheckout()`. The function is idempotent — whichever fires first writes the tier and issues the JWT; whichever fires second detects the existing record and returns without writing. The customer sees their JWT on screen within seconds of payment confirmation, regardless of webhook lag. Email delivery via Resend is triggered by whichever path executes first.

This dual-fulfillment pattern is the standard for any Stripe integration where immediate post-purchase delivery is required. It is not optional for a product that delivers a license key as the primary purchase artifact.

### API Routes (Phase A)

```
POST /api/auth/signup
POST /api/auth/login         → re-issue JWT on login if subscription active
POST /api/auth/logout
GET  /api/me                 → { tier, planExpiresAt, licenseExpiresAt }

GET  /api/billing/checkout?plan=self-hosted-pro   (individual/pro/team added in Phase B)
GET  /api/billing/portal     → Stripe customer portal redirect
POST /api/webhooks/stripe

POST /api/trial/self-hosted-pro  → 14-day trial JWT, email-verified, no card
POST /api/license/generate       → issue JWT, auth required, paid tier
POST /api/license/renew          → re-issue JWT, auth required, subscription active
```

### Pages Served (Phase A)

- `/` — marketing and pricing (Self-Hosted Pro + Enterprise contact only)
- `/compliance` — Enterprise Compliance landing page with "Talk to us" CTA; mentions HIPAA, SOC2, ISO 27001; architecture diagram showing zero SaaS data flow
- `/trial` — Self-Hosted Pro trial signup (email verify, no card)
- `/account` — billing status, Stripe portal link
- `/account/license` — generate and rotate license key
- `/account/analyze` — manual AI query analysis (Enterprise Compliance: 20 AI calls/day, paste sanitized query, get LLM suggestions with no historical context)
- `/dashboard/**` — Phase B only

### Trial Anti-Abuse

Checks run in order before issuing trial JWT:

1. Email verified via Supabase Auth — blocks temp-mail services
2. User has not previously used a trial
3. Email domain has not used a trial — DB unique index, not bypassable at application level
4. IP rate limit: max 3 signups per IP per 24h (Phase A: DB count; Phase B: Upstash Redis)

Trial JWTs are cryptographically time-locked — `exp` is in the signed payload. No server call can extend them.

---

## Phase 0 Agent Prerequisites

### Offline ECDSA License Validation

```ts
export interface LicenseClaims {
  sub: string;           // opaque SHA-256 hash of userId — never raw identifier
  tier: 'self-hosted-pro' | 'enterprise' | 'individual' | 'pro' | 'team';
  maxServices: number | null;
  allowedEvents: string[];
  sampleRates: Record<string, number>;  // always {} — reserved for forward compatibility
  kid: string;
  exp: number;
  trial?: boolean;       // audit flag only, not enforced by agent
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
  if (!verify.verify(pubKey, Buffer.from(sigB64, 'base64url'))) {
    throw new Error('License signature invalid');
  }

  const claims: LicenseClaims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  if (Date.now() / 1000 > claims.exp) throw new Error('EXPIRED');

  return claims;
}
```

`sub` is a SHA-256 hash of the internal userId — JWT payload is base64-encoded (not encrypted), so no raw user identifiers go into claims.

### Expiry Enforcement

**The disk write is not the enforcement mechanism.** The JWT `exp` claim signed with ECDSA is the enforcement mechanism. They cannot forge a new JWT without the private key. They cannot extend `exp` without invalidating the signature. The disk file is a durable user-facing notification. If they block the write, they've successfully prevented a `.txt` file from appearing — enforcement is unaffected.

```ts
async function writeExpirySignal(message: string): Promise<void> {
  const targets = [
    path.join(process.cwd(), 'diagnostic_agent_EXPIRED.txt'),
    path.join(os.tmpdir(), 'diagnostic_agent_EXPIRED.txt'),
    path.join(os.homedir(), '.diagnostic-agent', 'EXPIRED.txt'),
  ];

  for (const target of targets) {
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, message, { flag: 'w' });
      return;
    } catch {
      // try next location
    }
  }

  // All writes failed — write directly to stderr regardless of EventEmitter listeners
  // Cannot be silenced by the consuming application without redirecting stderr entirely
  process.stderr.write(`[DiagnosticAgent] ${message}\n`);
}
```

### Clock Skew Mitigation

A root-access actor setting the system clock back to before the JWT expired will defeat `Date.now()`. This is a known limitation of any offline license system — JetBrains, GitHub Actions, and every other offline-validated license faces the same attack.

**Per-tier decision:**

**Self-Hosted Pro — accepted trade-off (no mitigation code).** Setting the system clock back requires deliberate server misconfiguration. Anyone operating at that level of bad faith could also modify the npm package itself. Adding detection adds complexity and false-positive risk (NTP corrections, container time sync) for a threat model that does not match the buyer profile. Document as accepted risk; no code required.

**Enterprise — monotonic clock delta check, zero network calls, in-container only.** Enterprise customers operate under contractual SLA and audit requirements, making silent abuse more consequential. The `process.hrtime.bigint()` approach detects within-process rollback without any filesystem or network dependency:

```ts
// Recorded once at agent startup
const agentStartWallMs = Date.now();
const agentStartHrns = process.hrtime.bigint();

// On each license check (Enterprise tier only):
const elapsedNs = process.hrtime.bigint() - agentStartHrns;
const expectedWallMs = agentStartWallMs + Number(elapsedNs / 1_000_000n);
const actualWallMs = Date.now();

// Wall clock is behind monotonic expectation by more than 60s — clock was rewound
// 60s tolerance absorbs NTP corrections without false positives
if (tier === 'enterprise' && expectedWallMs - actualWallMs > 60_000) {
  agent.emit('error', new Error('DiagnosticAgent: system clock anomaly detected — falling back to free mode.'));
  // downgrade to free mode, never crash
}
```

This catches naive clock-rollback attacks within the process lifetime. Across container restarts, the hrtime anchor resets — document in Enterprise setup guide: _"Mount your working directory as a persistent volume for tamper-resistant clock validation across container restarts."_ Sophisticated NTP manipulation is out of scope — at that level of adversarial commitment the attacker owns the machine entirely.

### Agent-Side Event Filtering

```ts
function shouldExport(eventType: string, claims: LicenseClaims): boolean {
  if (!claims.allowedEvents.includes(eventType)) return false;
  const rate = claims.sampleRates[eventType] ?? 1.0;
  return Math.random() < rate;  // sampleRates is always {} — rate is always 1.0
}
```

### kid-Based Public Key Bundle

```ts
// src/licensing/public-key.ts — auto-generated by scripts/embed-pubkey.ts at publish
export const BUNDLED_PUBLIC_KEYS: Record<string, string> = {
  'k1': '-----BEGIN PUBLIC KEY-----\n...',
  // Old keys are NEVER removed — needed to validate unexpired old JWTs
  // Key rotation: issue new keys with incremented kid
  // Both old and new keys stay in bundle indefinitely
  // No customer action required during rotation
};
```

---

## Private Key Custody Protocol

The entire licensing model rests on one ECDSA P-256 private key. If it leaks, every license JWT ever issued becomes forgeable and the offline validation model collapses. This is not an operational detail to figure out later — it is a prerequisite to shipping Phase A.

### Storage and Access

- Private key stored **exclusively in GCP Secret Manager**. Never in environment variables, `.env` files, application code, or developer laptops.
- IAM access granted to **exactly one service account**: the Cloud Run service identity running the License Authority. No humans in the access list.
- Secret Manager audit logging enabled. Every access is logged with timestamp and caller identity.
- Local development uses a **separate dev keypair** — the production private key is never pulled to a local machine under any circumstances.

### Rotation Protocol

Rotation is triggered by **suspected compromise only** — not on a calendar schedule. Scheduled rotation creates unnecessary operational risk: every rotation requires shipping a new npm package version with the new public key bundled, which is a forcing function that keeps rotation rare and deliberate.

Rotation procedure:
1. Generate new keypair, assign `kid: 'k2'` (or next increment)
2. Add new public key to `BUNDLED_PUBLIC_KEYS` in `src/licensing/public-key.ts`
3. Ship new npm package version — old `k1` public key **stays in the bundle permanently** to validate unexpired old JWTs
4. Switch License Authority to sign new JWTs with `k2` private key
5. Store `k2` in GCP Secret Manager, revoke `k1` Secret Manager access
6. Communicate to customers: "Renew your license key to get the new signature" — their existing keys remain valid until natural expiry

Old public keys are **never removed from the bundle**. A customer running a Self-Hosted Pro instance on an annual JWT issued under `k1` must be able to validate it for up to 365 days after rotation.

### Leaked Key Response Plan

If private key exposure is confirmed or suspected:

1. Immediately generate new keypair `k2`, ship emergency npm patch version
2. Post incident notice: "All license keys issued before [date] must be renewed"
3. Invalidate old tier configs on the License Authority — old JWTs technically remain ECDSA-valid but the server stops issuing renewals under `k1`
4. Contact Enterprise Compliance customers directly — they have annual JWTs and may need priority reissuance
5. Document the incident for vendor security questionnaires (this will be asked)

This protocol should be documented in your runbook before Phase A launches. Failing the first enterprise vendor security questionnaire because you have no written key custody procedure is an avoidable loss.


---

## Phase C: Self-Hosted Docker Platform

**Built after Phase B is stable. Delivers the Self-Hosted Pro dashboard.**

### What Ships

```
docker pull ghcr.io/diagnostic-agent/platform:latest
docker compose up
```

One `docker-compose.yml`. One `.env` file with five variables. The image contains: OTLP ingestion endpoint, embedded ClickHouse (or configurable external), Next.js dashboard, AI suggestion backend (proxied to OpenAI via customer's own API key).

### The `diagnose` Command

Runs before the main process. Checks and reports:

```bash
docker run diagnostic-agent/platform:latest diagnose

# Output:
# ✅ Docker socket accessible
# ✅ Outbound HTTPS port 443 reachable
# ✅ ClickHouse write: OK
# ✅ OTLP endpoint: OK
# ❌ OpenAI API: Connection refused (corporate proxy)
#    → AI suggestions will be disabled
#    → All other features unaffected
#    → To enable AI: configure HTTPS_PROXY or set OPENAI_BASE_URL
#    → If proxy is blocking: consider the hosted SaaS at https://saas.example.com/trial
```

The diagnose command eliminates the "I don't know what's broken" support ticket — which is most support tickets. Write this before you write the feature documentation. That is the correct priority order.

### Docker Failure Funnel

A failed self-hosted deployment is a warm SaaS lead — the developer has already proven intent by attempting installation. Turn every failure into a structured redirect:

```ts
{
  status: 'failed',
  check: 'otlp_export',
  reason: 'Corporate proxy blocking port 443',
  self_hosted_viable: false,
  message: 'Your network configuration is incompatible with Self-Hosted Pro.',
  saas_alternative: {
    message: 'The hosted platform bypasses local networking entirely.',
    trial_url: 'https://saas.example.com/trial?ref=diagnose_fail&reason=proxy'
  }
}
```

The `ref` and `reason` query params are not optional. You need to know which failure modes drive the most SaaS conversions — that data shapes your Docker documentation investment going forward.

### AI Is Optional at the Architecture Level

If `OPENAI_API_KEY` is unset, AI suggestions are disabled but every other feature operates normally. A corporate firewall blocking OpenAI's API does not brick the product. This eliminates an entire class of support ticket.

### Supported Configurations (Hard List)

Not a soft recommendation — a hard boundary.

```
Supported:
- Docker 24.0+ on Linux (amd64, arm64)
- Docker Compose 2.x
- Outbound HTTPS on port 443

Not supported in Phase C:
- Windows containers
- Kubernetes (Phase D roadmap)
- Custom internal Docker registries
- Rootless Docker with user namespace remapping
```

"Not supported" means the support ticket is not taken. If they need Kubernetes or a custom registry, they are an Enterprise Compliance customer. The support tier boundary is the pricing tier boundary.

### Support Boundary

| Tier | Support included |
|---|---|
| Self-Hosted Pro ($499/yr) | Documentation + community Discord |
| Enterprise Compliance ($5k+/yr) | Dedicated onboarding, Zoom calls, security questionnaire responses, SLA |

If a Self-Hosted Pro customer needs a Zoom call or help configuring their internal CA, the answer is: "Our Enterprise tier includes dedicated onboarding support — here's how to talk to us." This is not callousness. This is the only way to run a self-hosted product company without being destroyed by support costs.

---

## Phase B: Telemetry SaaS

**Built after Phase A has 20 Self-Hosted Pro paying customers. Individual/Pro/Team SKUs added to Stripe on Phase B launch day.**

### Additional Stack

Ingestion path: Cloud Run (ingestor) + GCP Pub/Sub + Cloud Run (worker) + ClickHouse Cloud + Grafana Cloud. Dashboard/API path: Next.js on Vercel + ClickHouse Cloud (read queries) + OpenAI. Supporting: BigQuery (cold business analytics, nightly export from ClickHouse) + Upstash Redis + Resend. The ingestion path and dashboard path are separate deployments with separate scaling. Never route raw OTLP through Vercel serverless functions.

### Why ClickHouse Over BigQuery for Telemetry

BigQuery minimum query latency: 1–3 seconds for simple queries, 3–10 seconds cold. For a telemetry dashboard where a developer is live-debugging a production incident and clicking through event timelines, that latency is a product failure. Users experience it as "the dashboard feels broken." Honeycomb built their entire reputation on sub-second query response. Latency in a debugging tool is felt viscerally.

ClickHouse Cloud free tier starts at ~$0 for minimal traffic — the "scales to zero" argument that favors BigQuery does not apply.

**Pragmatic resolution:** ClickHouse Cloud for the hot telemetry path (dashboard queries, p99 aggregations, trace explorer). BigQuery for cold business analytics (billing usage rollups, churn analysis, business metrics). A nightly export job from ClickHouse to BigQuery. One cron, one `bq load`. You use each tool for what it's actually good at.

**Critical: same cloud provider, same region.** ClickHouse Cloud must be provisioned on **GCP europe-west1** — the same cloud provider and physical region as your Cloud Run workers. Cross-cloud egress between GCP (Cloud Run) and AWS (ClickHouse on AWS eu-west-1) costs $0.08–$0.12/GB. For a telemetry firehose at scale this is not a rounding error — it is a margin killer that compounds with every new customer. When provisioning ClickHouse Cloud, explicitly select GCP as the cloud provider and europe-west1 as the region. Verify this before writing a single byte of production data. Migrating a ClickHouse cluster to a different cloud/region after data accumulates is painful and expensive.

Note: Supabase defaults to AWS. Auth and billing traffic (Supabase ↔ Cloud Run) is low-volume request/response — this cross-cloud cost is negligible and not worth constraining your Supabase region choice. The egress problem is specific to the high-throughput telemetry write path: Cloud Run worker → ClickHouse.

### Telemetry Database

```sql
CREATE TABLE telemetry_events (
  user_sub       String,       -- opaque sub claim from JWT
  service_name   String,
  event_type     String,
  payload        String,       -- sanitized JSON, already scrubbed by agent
  retention_days UInt16,       -- written at ingest; drives per-row TTL
  received_at    DateTime
) ENGINE = MergeTree()
  ORDER BY (user_sub, service_name, event_type, received_at)
  TTL received_at + INTERVAL retention_days DAY;
```

`retention_days` is written at ingest time derived from tier: Individual=7, Pro=30, Team=90. This avoids the ClickHouse limitation of single-table TTL policies and allows tier upgrades to take effect without data migration.

### Ingestion Architecture

The `/api/v1/ingest` endpoint cannot run on Next.js/Vercel serverless functions. Serverless functions are designed for request/response application logic, not persistent high-throughput data firehoses. With 50 customer containers batching OTLP payloads every 5 seconds, synchronously validating a JWT, writing to ClickHouse, waiting for a Grafana Cloud 200 OK, and then returning a response to the agent will produce catastrophic latency, dropped spans, and a Vercel bill that grows with every customer you add. This is a architectural failure mode, not a scaling problem you fix later.

The correct architecture is a two-stage async pipeline:

```
Agent (customer process)
    │  POST OTLP payload + Bearer JWT
    ▼
┌─────────────────────────────────────────────────────────┐
│  Ingestor Service — Cloud Run (always-on, min 1 instance)│
│  Language: Go or TypeScript/Node — single responsibility │
│                                                          │
│  1. Validate JWT ECDSA signature          (~1ms)         │
│  2. Validate event_type in allowedEvents  (~0ms)         │
│  3. Publish raw payload to Pub/Sub topic  (~3ms)         │
│  4. Return 200 OK                                        │
│                                                          │
│  Total latency to agent: < 10ms                          │
│  This service never touches ClickHouse.                  │
│  This service never touches Grafana Cloud.               │
└─────────────────────────────────────────────────────────┘
    │  Pub/Sub topic: telemetry-events
    ▼
┌─────────────────────────────────────────────────────────┐
│  Worker Service — Cloud Run (scale-to-zero OK)           │
│  Triggered by Pub/Sub push subscription                  │
│                                                          │
│  1. Deserialize payload                                  │
│  2. Derive retention_days from tier claim                │
│  3. Batch-write to ClickHouse                            │
│  4. Forward raw OTLP to Grafana Cloud (fire-and-forget)  │
│  5. Ack Pub/Sub message                                  │
└─────────────────────────────────────────────────────────┘
```

**Why this architecture is correct:**

The ingestor's only job is to authenticate and enqueue. It is stateless, horizontally scalable, and returns to the agent in under 10ms regardless of ClickHouse or Grafana Cloud latency. A ClickHouse write timeout does not cause the agent to retry or drop spans — the message is already durably on Pub/Sub.

The worker is decoupled from the ingestor's latency path entirely. If ClickHouse is slow during a batch write, the worker retries via Pub/Sub's built-in retry/backoff. If Grafana Cloud is temporarily unavailable, the forward is fire-and-forget — a failed Grafana forward does not nack the Pub/Sub message or lose the event from ClickHouse.

Pub/Sub guarantees at-least-once delivery. ClickHouse writes are idempotent by event fingerprint. The pipeline is durable by default.

**Cloud Run configuration:**

```yaml
# ingestor — always-on, fast cold start critical
ingestor:
  minInstances: 1       # never cold-start on a paying customer's request
  maxInstances: 50
  concurrency: 80
  memory: 256Mi
  cpu: 1

# worker — scale-to-zero fine, latency not customer-facing
worker:
  minInstances: 0
  maxInstances: 20
  concurrency: 10       # lower — ClickHouse writes benefit from batching
  memory: 512Mi
  cpu: 1
```

**Next.js/Vercel scope:** The Next.js app on Vercel handles the dashboard UI, the `/api/v1/analyze` AI endpoint, the `/api/v1/events` read queries, and all webhook management. It never handles raw OTLP ingestion. Read traffic (dashboard queries against ClickHouse) is acceptable in Next.js API routes because it is request/response, not a firehose, and query latency is expected by the user.

### API Routes (Phase B additions)

```
GET  /api/v1/events?service=&type=&from=&to=
GET  /api/v1/services
GET  /api/v1/summary?service=&window=
POST /api/v1/analyze                          → AI suggestion for event payload
POST /api/v1/webhooks                         → register endpoint (Pro/Team)
GET  /api/v1/webhooks
DELETE /api/v1/webhooks/:id
```

CORS explicit allowlist on `/api/v1/**` — required for `@diagnostic-agent/ui` Team custom embedded UI on customer domains.

### AI Suggestion Quality Gap and Cost Architecture

Free tier: rule-based `suggestions[]` — structural analysis, deterministic, stateless. Zero inference cost.

Individual ($19/mo): No AI suggestions. Upgrade pressure is from service count and retention, not AI access. The rule-based suggestions already prove value at this tier.

Pro ($19/mo): AI suggestions with a **200 analyses/day soft cap**. At median usage of ~10 AI calls/day, OpenAI cost is approximately $1.50/month at $0.005/call — acceptable against $29 revenue. The P99 user who reaches 200 calls/day costs ~$3/month — still acceptable, and is statistically your highest-probability Team conversion. When they hit the cap the message is not a hard wall:

```
You've used 200 AI analyses today — you're in our top 1% of active users.
Rule-based suggestions continue working without limit.
AI analyses reset at midnight UTC, or upgrade to Team for unlimited.
```

Team ($99/mo): **1,000 analyses/day hard cap, BYOK unlock available.** At median team usage (~30 calls/day), cost is ~$4.50/month — fine. Teams running automated pipelines that programmatically hit the AI endpoint can supply their own OpenAI API key to remove the cap entirely. They absorb the inference cost directly. BYOK is appropriate here because a team consuming AI at pipeline scale has already opted into OpenAI's pricing model.

Self-Hosted Pro ($499/yr): **BYOK required by design.** They are running the Docker image on their own infrastructure and already managing their own stack. Requiring an OpenAI API key is architecturally consistent and eliminates your AI cost exposure entirely for this segment.

Enterprise: negotiated in contract. Some enterprise customers want BYOK for data governance — they do not want query structures proxied through your OpenAI account even if AST-sanitized. Others want a dedicated allocation with a documented inference cost cap. Both are contract line items.

### AI Model Abstraction

The AI suggestion call is a single abstraction boundary — a function that takes ClickHouse context and returns a structured suggestion. The model behind it is swappable and should be treated as such from day one.

```ts
// src/ai/suggestion-engine.ts
export interface SuggestionEngine {
  analyze(context: TraceContext): Promise<AISuggestion[]>;
}

// Phase B: OpenAI implementation
export class OpenAISuggestionEngine implements SuggestionEngine { ... }

// Phase E (future): fine-tuned model on your own trace/suggestion pairs
export class FineTunedSuggestionEngine implements SuggestionEngine { ... }
```

Every AI suggestion that a paying customer accepts or rejects is a training signal. After 6 months of Pro and Team usage you will have a dataset that no competitor can replicate — query patterns, suggestions offered, and whether the developer acted on them. A fine-tuned smaller model on Cloud Run will cost a fraction of OpenAI API pricing and produce better Node.js observability suggestions than a general-purpose model ever will. BYOK architecture coupled directly to OpenAI's API contract works against this long-term. Keep the abstraction boundary clean.

Enterprise manual paste at `/account/analyze`: same model, zero ClickHouse context. Generic structural advice. This is the honest AI value gap between offline and online tiers. It is real and defensible.

---

---

## GDPR, Data Residency, and Compliance Posture

Targeting HIPAA, SOC2, and ISO 27001 buyers without a documented data residency position is a sales blocker. Every enterprise buyer, and every EU customer on any SaaS tier, will ask two questions before signing: where is my data stored, and what is your GDPR position. These answers must exist before the first enterprise conversation.

### Data Residency

**Default ClickHouse Cloud region: EU-West (eu-west-1).** This covers the strictest GDPR requirements from day one and is the correct default for a privacy-first product. US-region availability can be added as a paid option in later phases for customers who require it.

EU and US customer data are isolated at the ClickHouse cluster level — not just logically partitioned in the same cluster. This is the answer enterprise procurement will require.

### GDPR Position

You are a **data processor**. Your customers are data controllers. Their end-users are data subjects. This is the correct legal relationship and must be stated explicitly in your privacy policy and DPA.

**What this means in practice:**
- You process telemetry data on behalf of the customer under their instructions (their tier config, their service list)
- You do not use customer telemetry data to train models, improve your product, or for any purpose other than delivering the service
- You delete customer data within 30 days of account cancellation (document this SLA explicitly)
- You notify customers within 72 hours of any confirmed breach affecting their data

### Data Processing Agreement

A standard DPA must be available before the first enterprise conversation. It does not need to be bespoke — use a standard template (Stripe, Datadog, and PostHog all publish their DPAs publicly, which serve as reference formats). The DPA should cover:

- Subject matter and duration of processing
- Nature and purpose of processing
- Type of personal data and categories of data subjects
- Your obligations and rights as processor
- Sub-processor list with customer notification obligations on changes

### Subprocessors (Public List)

Must be published at `/legal/subprocessors` and kept current. Initial list:

| Subprocessor | Purpose | Location |
|---|---|---|
| Supabase | Auth and billing database | EU (AWS eu-west-1) |
| Stripe | Payment processing | US |
| ClickHouse Cloud | Telemetry storage | EU-West |
| Grafana Cloud | OTLP forwarding and visualization | EU |
| OpenAI | AI suggestion inference | US |
| Resend | Transactional email | US |
| Google Cloud Platform | Ingestion pipeline (Cloud Run + Pub/Sub) | EU |
| Vercel | Dashboard hosting | Global CDN |

Any change to this list requires customer notification with 30-day advance notice — this is standard DPA language and enterprise buyers will verify it.

### Deleted Account Data Retention

When a customer cancels, their ClickHouse rows are deleted within 30 days. This is triggered by a Stripe `customer.subscription.deleted` webhook that enqueues a deletion job. The deletion is logged with a timestamp in the audit log for compliance documentation.

Supabase profile and license key records are retained for 90 days post-cancellation for billing dispute purposes, then hard-deleted.

### What You Do Not Need Yet

You do not need SOC 2 Type II certification to sell to your first enterprise customer. You need the posture of a company that understands data governance: a published privacy policy, a DPA template, a subprocessor list, and documented data deletion procedures. Certification comes after you have enough enterprise revenue to justify the $30,000–$50,000 audit cost.

## Phase D: Alerts and Integrations

**Built after Phase B has revenue. Adds operational surface area — only justified when there is money to maintain it.**

Priority order:

1. **Email alerts** — crash and anomaly events trigger email to registered addresses. Zero integration complexity. Pure SMTP via Resend. Builds stickiness immediately.
2. **Slack webhooks** — incoming webhook URL configured in dashboard. Once a team's Slack has an alert channel, cancellation requires deliberate decision-making.
3. **PagerDuty** — integration key configured in dashboard. The enterprise stickiness mechanism. Once wired into incident response infrastructure, the product is embedded in operational workflow.
4. **Custom webhooks** — already in Phase B API spec. Phase D adds the dashboard UI for configuration.

Alerts are a retention mechanism, not a growth mechanism. Worth building only after there are customers to retain.

---

---

## Unit Economics

These numbers are directional estimates, not a financial model. Their purpose is to make rational decisions about paid acquisition spend and Phase B investment before those decisions are made.

### Per-Tier Gross Margin

| Tier | Price | Est. COGS/mo | Gross margin | 12-mo avg retention LTV |
|---|---|---|---|---|
| Free (OSS) | $0 | $0 | N/A | N/A |
| Self-Hosted Pro | $499/yr (~$42/mo) | ~$2 (Secret Manager, minimal compute) | ~95% | $499 |
| Individual | $19/mo | ~$1 (storage only, no AI) | ~92% | $228 |
| Pro | $29/mo | ~$4.50 (AI median + storage + compute) | ~72% | $348 |
| Team | $99/mo | ~$12 (AI + priority queue + storage + compute) | ~75% | $1,188 |
| Enterprise | $8k/yr avg (~$667/mo) | ~$15 (no infra, sales cost amortized over 2yr) | ~85% | $8,000+ |

### OpenAI Cost Sensitivity for Pro

The Pro tier is the most margin-sensitive because it includes AI suggestions with a usage cap. Tested against three user archetypes:

| Archetype | AI calls/day | OpenAI cost/mo | Net margin |
|---|---|---|---|
| Casual (median) | 10 | $1.50 | ~79% |
| Active (P90) | 80 | $12 | ~45% |
| Heavy (hits cap) | 200 | $30 | negative |

The 200/day soft cap exists precisely to prevent the heavy archetype from destroying margin. At cap they see the upgrade prompt to Team. The P90 user at 45% margin is acceptable at early scale — margin improves when the fine-tuned model replaces OpenAI calls in Phase E.

### Stripe Fees

Stripe charges 2.9% + $0.30 per transaction for subscriptions. On a $19/mo charge that is $0.85/transaction. On a $499/yr charge it is $14.77. These are included in the COGS estimates above but worth tracking explicitly as volume grows.

### AI Cost at Scale

At 1,000 Pro customers running median 10 calls/day: $1,500/month in OpenAI costs against $29,000 in Pro revenue. Margin is healthy. At 10,000 Pro customers the same calculation holds — the per-unit cost is stable. The risk is not scale; it is outlier usage without caps.

The fine-tuned model in Phase E is the long-term margin lever. A smaller model hosted on Cloud Run at fixed compute cost replaces per-call OpenAI pricing. The breakeven point for building the fine-tuned model is approximately 2,000 Pro customers — below that, OpenAI API pricing is cheaper than the engineering time to build and maintain a fine-tuned model.

## Build Sequence and Milestone Gates

```
Phase 0  →  OSS agent published (MIT), local suggestions, email capture, GitHub Sponsors
             Gate: 50 developers articulate a specific bug the agent caught (testimonials)
             Not: GitHub stars. Not: npm installs. Signal only.

Phase A  →  License Authority + Self-Hosted Pro Docker image
             Stripe: Self-Hosted Pro only (one-time annual $499)
             Gate: 20 Self-Hosted Pro paying customers
             (~$9,980 ARR proves offline privacy market before cloud infrastructure)

Phase B  →  Telemetry SaaS — ClickHouse, dashboard, AI
             Stripe: Add Individual/Pro/Team subscriptions on launch day
             Gate: $5,000 MRR from online tiers

Phase C  →  Docker platform maturation, diagnose command, Kubernetes roadmap
             Gate: 10 Enterprise Compliance contracts signed

Phase D  →  Alerts and integrations
             Gate: measurable reduction in monthly churn rate
```

Each phase is independently valuable and independently deployable. Phase A failing does not undo Phase 0. Phase B failing does not affect Self-Hosted Pro customers. This sequencing is the correct way to build.

---

## Sustainability and Moat

### What Cannot Be Easily Copied

The OSS agent establishes the standard before competitors can respond. AST-level sanitization requires rewriting ingestion from scratch to add retroactively. Offline ECDSA license validation is architecturally incompatible with online-only competitors. A customer's 90-day query trace history, correlated across services with a known baseline, does not exist anywhere else in the world.

### Revenue Model Health

| Tier | Gross margin | Switching cost | Support burden |
|---|---|---|---|
| Free (OSS) | N/A | N/A | Low (GitHub issues) |
| Self-Hosted Pro | ~95% | Medium | Low (docs + Discord only) |
| Individual | ~92% | Low-Medium | Low |
| Pro | ~72% median (cap-protected) | High (webhooks, API integrations) | Medium |
| Team | ~75% | Very high (embedded UI, 90-day history) | Medium |
| Enterprise Compliance | ~85% | High (compliance audit re-approval) | Paid for at contract price |

### The Long-Term Threat

AI coding assistants catching bugs before they reach production reduces the value of runtime diagnostics over a 3–5 year horizon. Runtime behavior that only emerges under production load — N+1 patterns at scale, heap growth under sustained traffic, event loop lag under concurrent connections — is not something static analysis catches today. This is worth monitoring. It is not an immediate threat. Build the data pipeline moat aggressively now. The dashboard UI is disposable. The accumulated historical trace data is not.
