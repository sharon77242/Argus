# Phase A — License Authority

> **Gate metric:** 20 Self-Hosted Pro paying customers at $499/yr (~$9,980 ARR).
> Do not build Phase B until this gate is cleared.

**Stack:** Next.js 14 App Router · Supabase · Stripe · Resend · Vercel · GCP Secret Manager
**No ClickHouse. No Redis. No Grafana. No AI inference.**

---

## A.1 — Account & Project Setup

### A.1.1 — Supabase

1. Create project at supabase.com → name: `argus-prod`
2. Set region: **EU West (Ireland)** — GDPR default
3. Copy: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
4. Enable **Email Auth** under Authentication → Providers → Email
5. Set `Site URL` = `https://argus.dev` (update after Vercel deploy)
6. Enable email confirmations (required for trial anti-abuse)

### A.1.2 — Stripe

1. Create account at stripe.com
2. Create products and prices:

| Product | Mode | Price | Env var |
|---|---|---|---|
| Self-Hosted Pro | one-time payment | $499 | `STRIPE_SELF_HOSTED_PRO_PRICE_ID` |
| Individual | subscription | $19/mo | `STRIPE_INDIVIDUAL_PRICE_ID` |
| Pro | subscription | $29/mo | `STRIPE_PRO_PRICE_ID` |
| Team | subscription | $99/mo | `STRIPE_TEAM_PRICE_ID` |

> Individual/Pro/Team: add `trial_period_days: 14` when creating prices.
> **Phase A only activates Self-Hosted Pro.** Individual/Pro/Team products are created now but not linked to checkout until Phase B launches.

3. Create webhook endpoint → `https://argus.dev/api/webhooks/stripe`
4. Subscribe to events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
5. Copy `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

### A.1.3 — Resend

1. Create account at resend.com
2. Add and verify domain (`mail.argus.dev`)
3. Copy `RESEND_API_KEY`

### A.1.4 — GCP Secret Manager (private key storage)

1. Create GCP project: `argus-licensing`
2. Enable Secret Manager API
3. Generate ECDSA P-256 keypair:

```bash
openssl ecparam -name prime256v1 -genkey -noout -out private.pem
openssl ec -in private.pem -pubout -out public.pem
```

4. Store private key in Secret Manager:
```bash
gcloud secrets create ARGUS_LICENSE_PRIVATE_KEY --data-file=private.pem
```

5. **Delete local `private.pem` immediately** — it must never exist on disk after this step
6. Keep `public.pem` — it goes into `packages/agent/src/licensing/public-key.ts`
7. Set `KEY_ID=k1` in Vercel env vars

### A.1.5 — Vercel

1. Create account / project at vercel.com
2. Connect GitHub repo, set root directory to `packages/saas`
3. Add all env vars from §A.9 (Environment Variables)
4. Enable **Edge Config** if needed for rate limiting (or use DB count for Phase A)

---

## A.2 — Next.js App Scaffold

```bash
cd packages/saas
pnpm create next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*"
pnpm add @supabase/supabase-js @supabase/ssr stripe resend jsonwebtoken
pnpm add -D @types/jsonwebtoken
```

### A.2.1 — Directory structure

```
packages/saas/
  app/
    (auth)/
      login/page.tsx
      signup/page.tsx
      logout/route.ts
    account/
      page.tsx              ← billing status + Stripe portal link
      license/page.tsx      ← generate / rotate license key
      analyze/page.tsx      ← manual AI query analysis (Phase B; stub in Phase A)
      success/page.tsx      ← post-checkout synchronous fulfillment
    trial/page.tsx          ← Self-Hosted Pro trial signup
    pricing/page.tsx
    compliance/page.tsx     ← Enterprise landing, "Talk to us" CTA
    page.tsx                ← marketing / homepage
    api/
      auth/
        signup/route.ts
        login/route.ts
        logout/route.ts
      me/route.ts
      billing/
        checkout/route.ts
        portal/route.ts
      webhooks/
        stripe/route.ts
      trial/
        self-hosted-pro/route.ts
      license/
        generate/route.ts
        renew/route.ts
  lib/
    supabase/
      client.ts             ← browser client
      server.ts             ← server client (cookies)
      admin.ts              ← service role client
    stripe.ts
    resend.ts
    licensing/
      validator.ts          ← imported from packages/agent OR duplicated here
      generator.ts          ← JWT signing (server-side only)
      tier-config.ts
  middleware.ts             ← Supabase Auth session refresh
```

### A.2.2 — Supabase middleware

`middleware.ts` — refresh session on every request using `@supabase/ssr`.

---

## A.3 — Database Schema

Run in Supabase SQL editor:

```sql
-- Profiles (extends Supabase auth.users)
create table public.profiles (
  id                         uuid primary key references auth.users(id) on delete cascade,
  email                      text not null,
  tier                       text not null default 'free'
                               check (tier in ('free','self-hosted-pro','enterprise','individual','pro','team')),
  stripe_customer_id         text unique,
  stripe_subscription_id     text,
  plan_expires_at            timestamptz,
  -- Trial abuse prevention (DB-enforced, not application-level)
  email_domain               text generated always as (split_part(email, '@', 2)) stored,
  self_hosted_trial_used     boolean not null default false,
  self_hosted_trial_at       timestamptz,
  created_at                 timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Own profile only" on public.profiles
  for all using (auth.uid() = id);

-- One trial per email domain — DB-enforced, not bypassable at application level
create unique index one_self_hosted_trial_per_domain
  on public.profiles (email_domain)
  where self_hosted_trial_used = true;

-- License key audit log — SHA-256 hash only, NEVER plaintext
create table public.license_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade,
  key_hash    text not null unique,        -- SHA-256(licenseKey)
  tier        text not null,
  issued_at   timestamptz default now(),
  expires_at  timestamptz not null
);

alter table public.license_keys enable row level security;
create policy "Own keys" on public.license_keys
  for all using (auth.uid() = user_id);
```

Trigger to auto-create profile on signup:
```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

---

## A.4 — Licensing: JWT Generation (`lib/licensing/`)

### A.4.1 — `tier-config.ts`

```ts
export const TIER_CONFIG = {
  'self-hosted-pro': {
    maxServices:   null,
    allowedEvents: ['crash','anomaly','leak','query','http','log','fs'],
    sampleRates:   {},
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
    sampleRates:   {},   // full fidelity — no sampling on any tier
    expDays:       30,
  },
  'team': {
    maxServices:   null,
    allowedEvents: ['crash','anomaly','leak','query','http','log','fs'],
    sampleRates:   {},
    expDays:       30,
  },
} as const;
```

### A.4.2 — `generator.ts`

```ts
import { createSign } from 'node:crypto';
import { createHash } from 'node:crypto';
import { TIER_CONFIG } from './tier-config';

const PRIVATE_KEY = process.env.PRIVATE_KEY!;   // PEM from GCP Secret Manager via Vercel env

export function generateLicenseJwt(userId: string, tier: keyof typeof TIER_CONFIG): string {
  const config = TIER_CONFIG[tier];
  const sub = createHash('sha256').update(userId).digest('hex').slice(0, 16); // opaque

  const header = { alg: 'ES256', kid: process.env.KEY_ID! };
  const claims = {
    sub,
    tier,
    maxServices:   config.maxServices,
    allowedEvents: config.allowedEvents,
    sampleRates:   config.sampleRates,
    kid:           process.env.KEY_ID!,
    iat:           Math.floor(Date.now() / 1000),
    exp:           Math.floor(Date.now() / 1000) + config.expDays * 86400,
  };

  const headerB64  = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signing    = `${headerB64}.${payloadB64}`;

  const sign = createSign('SHA256');
  sign.update(signing);
  const sigB64 = sign.sign(PRIVATE_KEY, 'base64url');

  return `${signing}.${sigB64}`;
}

export function hashLicenseKey(jwt: string): string {
  return createHash('sha256').update(jwt).digest('hex');
}
```

---

## A.5 — Auth Routes

### A.5.1 — `api/auth/signup/route.ts`

1. `supabase.auth.signUp({ email, password })`
2. Return `{ message: 'Check your email to confirm' }`
3. Do NOT issue license JWT here — only after email confirmation + payment

### A.5.2 — `api/auth/login/route.ts`

1. `supabase.auth.signInWithPassword({ email, password })`
2. On success: check `profile.tier` — if paid and `plan_expires_at > now`, re-issue fresh JWT
3. Return session + optional new license key

### A.5.3 — `api/auth/logout/route.ts`

`supabase.auth.signOut()`

---

## A.6 — Billing Routes

### A.6.1 — `api/billing/checkout/route.ts`

```ts
const STRIPE_CONFIG = {
  'self-hosted-pro': {
    priceId: process.env.STRIPE_SELF_HOSTED_PRO_PRICE_ID!,
    mode: 'payment' as const,        // one-time annual — NOT subscription
    trial: false,
  },
  // Individual/Pro/Team: added to checkout in Phase B only
};

// GET /api/billing/checkout?plan=self-hosted-pro
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const plan = searchParams.get('plan') as keyof typeof STRIPE_CONFIG;
  const config = STRIPE_CONFIG[plan];
  if (!config) return Response.json({ error: 'INVALID_PLAN' }, { status: 400 });

  const session = await stripe.checkout.sessions.create({
    customer_email: user.email,
    line_items: [{ price: config.priceId, quantity: 1 }],
    mode: config.mode,
    success_url: `${BASE_URL}/account/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${BASE_URL}/pricing`,
    metadata:    { userId: user.id, plan },
  });

  return Response.redirect(session.url!);
}
```

### A.6.2 — `api/billing/portal/route.ts`

```ts
const session = await stripe.billingPortal.sessions.create({
  customer: profile.stripe_customer_id,
  return_url: `${BASE_URL}/account`,
});
return Response.redirect(session.url);
```

### A.6.3 — `account/success/page.tsx` — Dual fulfillment (critical)

```ts
// Synchronous fulfillment path — does NOT wait for webhook
const session = await stripe.checkout.sessions.retrieve(sessionId, {
  expand: ['subscription', 'payment_intent'],
});

if (session.payment_status !== 'paid') return <PendingPaymentPage />;

// Idempotent — check if webhook already processed
const existing = await getProfile(userId);
if (existing.tier !== 'free') {
  const key = await getLatestLicenseKey(userId);
  return <SuccessPage licenseKey={key} />;
}

// Webhook has not fired yet — fulfill now
// fulfillCheckout() is idempotent; webhook will be a no-op when it arrives
const licenseKey = await fulfillCheckout(session, userId);
return <SuccessPage licenseKey={licenseKey} />;
```

### A.6.4 — `api/webhooks/stripe/route.ts`

Always call `stripe.webhooks.constructEvent()` first — reject if signature invalid.

```ts
switch (event.type) {
  case 'checkout.session.completed':
    // Self-Hosted Pro (one-time payment)
    // Idempotency: check profile.tier before writing
    await fulfillCheckout(session, userId);
    break;

  case 'invoice.payment_succeeded':
    // Subscription tiers (Individual/Pro/Team) — re-issue 30-day JWT
    await reissueLicenseJwt(userId);
    break;

  case 'invoice.payment_failed':
    await supabaseAdmin.from('profiles')
      .update({ tier: 'free' })
      .eq('stripe_subscription_id', subscriptionId);
    await sendPaymentFailedEmail(userEmail);
    break;

  case 'customer.subscription.deleted':
    await supabaseAdmin.from('profiles')
      .update({ tier: 'free', stripe_subscription_id: null, plan_expires_at: null })
      .eq('stripe_subscription_id', event.data.object.id);
    break;

  case 'customer.subscription.updated':
    // Handle upgrades/downgrades
    await updateTierFromSubscription(event.data.object);
    break;
}
```

---

## A.7 — License API Routes

### A.7.1 — `api/license/generate/route.ts`

Auth required. Tier must not be `'free'`.

```ts
const licenseKey = generateLicenseJwt(user.id, profile.tier);
const keyHash    = hashLicenseKey(licenseKey);
const config     = TIER_CONFIG[profile.tier];

await supabaseAdmin.from('license_keys').insert({
  user_id:    user.id,
  key_hash:   keyHash,
  tier:       profile.tier,
  expires_at: new Date((Math.floor(Date.now() / 1000) + config.expDays * 86400) * 1000).toISOString(),
});

return Response.json({ licenseKey });
// licenseKey shown ONCE — never stored plaintext, never returned again
```

### A.7.2 — `api/license/renew/route.ts`

Auth required. Verify `profile.tier !== 'free'` and subscription active.
Same as generate — issues a new JWT, stores new hash. Old JWT remains valid until its own `exp`.

---

## A.8 — Trial Flow (Self-Hosted Pro, no card)

### A.8.1 — `api/trial/self-hosted-pro/route.ts`

Checks in order (fail fast):

1. User email confirmed (Supabase `email_confirmed_at` not null)
2. `profile.self_hosted_trial_used === false`
3. Domain trial check: `count profiles where email_domain = domain AND self_hosted_trial_used = true` → must be 0
4. IP rate limit: count trial signups from this IP in last 24h via DB → must be < 3

If all pass:
```ts
const trialKey = generateLicenseJwt(user.id, 'self-hosted-pro'); // 14-day exp override
// Update profile: self_hosted_trial_used=true, self_hosted_trial_at=now
// Insert into license_keys with tier='self-hosted-pro-trial'
// Send welcome email via Resend
return Response.json({ licenseKey: trialKey });
```

Expiry renewal message in agent: link to `/pricing` (not `/account/license`) — prompts purchase.

---

## A.9 — Pages

### A.9.1 — `/` (marketing)

- Above the fold: 60-second GIF + one-line value prop
- Pricing table: Free / Self-Hosted Pro / Individual / Pro / Team / Enterprise
- Individual/Pro/Team show "Coming soon — join waitlist"
- CTA: "Get Self-Hosted Pro" → `/api/billing/checkout?plan=self-hosted-pro`
- CTA: "Free trial (14 days, no card)" → `/trial`

### A.9.2 — `/compliance`

- Architecture diagram showing zero SaaS data flow for Enterprise
- Mentions HIPAA, SOC2, ISO 27001 posture
- "Talk to us" CTA → mailto or Typeform

### A.9.3 — `/account`

- Tier badge + plan expiry
- "Manage billing" → `/api/billing/portal`
- "Generate license key" → link to `/account/license`

### A.9.4 — `/account/license`

- Show license key **once** after generation (copy-to-clipboard)
- "Rotate key" button → `POST /api/license/renew`
- Expiry date prominently displayed

---

## A.10 — Resend Emails

| Trigger | Subject | Content |
|---|---|---|
| `checkout.session.completed` | Welcome to Argus | Paste this key as `DIAGNOSTIC_LICENSE_KEY`. Renewal reminder in 11 months. |
| `invoice.payment_failed` | Action required — Argus payment failed | Update payment method link. Will downgrade to free in 7 days. |
| `trial/self-hosted-pro` | Your Argus trial key | 14-day key. Link to buy. |

---

## A.11 — Vercel Deployment

### A.11.1 — Deploy

1. Push to `main` → Vercel auto-deploys `packages/saas`
2. Set custom domain: `argus.dev`
3. Verify Supabase `Site URL` matches

### A.11.2 — Environment Variables

| Variable | Source | Description |
|---|---|---|
| `PRIVATE_KEY` | GCP Secret Manager → Vercel | PEM ECDSA private key (never in git) |
| `KEY_ID` | Vercel | Current key ID (`k1`) |
| `STRIPE_SECRET_KEY` | Stripe dashboard | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard | Webhook signing secret |
| `STRIPE_SELF_HOSTED_PRO_PRICE_ID` | Stripe dashboard | $499/yr one-time price |
| `STRIPE_INDIVIDUAL_PRICE_ID` | Stripe dashboard | $19/mo (Phase B) |
| `STRIPE_PRO_PRICE_ID` | Stripe dashboard | $29/mo (Phase B) |
| `STRIPE_TEAM_PRICE_ID` | Stripe dashboard | $99/mo (Phase B) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard | Service role (server-only) |
| `RESEND_API_KEY` | Resend dashboard | Transactional email |
| `BASE_URL` | Vercel | `https://argus.dev` |

### A.11.3 — Security headers (`next.config.ts`)

```ts
headers: [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  },
]
```

---

## A.11b — Self Code Review

Issues found and corrected:

| Issue | Location | Fix |
|---|---|---|
| `generateLicenseJwt` imports `jsonwebtoken` but uses manual `createSign` — inconsistent | `lib/licensing/generator.ts` | Standardize on manual `createSign('SHA256')` / `createVerify('SHA256')` — zero dependency, explicit, security-auditable |
| Trial IP rate limiting counts from `profiles` table which has no IP column | `api/trial/self-hosted-pro/route.ts` | Add `ip_address inet` to a separate `signup_attempts` table: `(ip, attempted_at)`. Count rows in last 24h. Never store IP on `profiles` — it's PII. |
| `fulfillCheckout` is referenced in both success page and webhook but defined nowhere in the plan | `lib/fulfillment.ts` | Define as a standalone idempotent function: check existing tier, write tier + issue JWT + send email atomically. Both callers import it. |
| `getLatestLicenseKey(userId)` in success page — not defined | `lib/licensing/queries.ts` | Add: select latest `license_keys` row for user ordered by `issued_at desc limit 1`. Return JWT hash? No — the JWT itself is never stored. Re-generate on demand or return the one just issued and cached in the request. |
| `getProfile(userId)` referenced but not defined | `lib/supabase/queries.ts` | Define consistent query helpers as the first thing built — they are used everywhere |
| Supabase service role key used in webhook handler running on Vercel Edge — service role key must be server-only | `api/webhooks/stripe/route.ts` | Mark route as `export const runtime = 'nodejs'` — never Edge. Service role key cannot be in browser bundle. |

---

## A.12 — Test Coverage Requirements

Test runner: Node.js built-in `--test`. Coverage target: **≥90% line coverage** on all `lib/licensing/` code.

### Required test files

| File | What to cover |
|---|---|
| `tests/licensing/generator.test.ts` | JWT contains correct claims per tier; `sub` is opaque hash not raw userId; `sampleRates` is always `{}`; `exp` is `now + expDays * 86400`; `kid` matches env var |
| `tests/licensing/tier-config.test.ts` | `allowedEvents` correct per tier; `maxServices` correct; `sampleRates` always `{}`; no tier has sampling |
| `tests/webhooks/stripe.test.ts` | `constructEvent` called before payload read; `checkout.session.completed` is idempotent (second call no-ops); `invoice.payment_failed` sets tier to `'free'`; `subscription.deleted` nullifies subscription columns |
| `tests/trial/anti-abuse.test.ts` | Unverified email → 403; already used trial → 403; domain already used → 403; IP > 3 in 24h → 429; all checks pass → JWT issued with 14-day exp |
| `tests/billing/dual-fulfillment.test.ts` | Success page calls `fulfillCheckout` when tier=free; webhook handler calls `fulfillCheckout`; second call (webhook after page) is no-op; second call (page after webhook) is no-op |
| `tests/billing/checkout.test.ts` | `offline-pro` plan → 400 INVALID_PLAN (only self-hosted-pro valid in Phase A); valid plan → redirect to Stripe URL |

### Integration tests (run against Supabase local dev)

```bash
# Start Supabase local
npx supabase start
# Run integration tests only
node --test --experimental-strip-types tests/integration/**/*.test.ts
```

- [ ] Full signup → checkout → success page → license key visible flow
- [ ] Webhook fires after success page: idempotent (no duplicate records)
- [ ] Trial: domain unique index actually blocks second signup at DB level

---

## A.13 — Security Checklist

- [ ] Clock manipulation (Self-Hosted Pro): accepted trade-off. Documented here. System clock rollback requires deliberate misconfiguration; attacker could equally modify the npm package.
- [ ] Clock manipulation (Enterprise): `checkClockIntegrity()` gated to `tier === 'enterprise'`, 60s NTP tolerance. See `packages/agent/src/licensing/clock-guard.ts`.
- [ ] Stripe webhook: always `stripe.webhooks.constructEvent()` before reading any payload
- [ ] License JWT: validate `exp`, `alg === 'ES256'` (reject `none`/`HS*`), `kid` exists
- [ ] Private key: never logged, never in any response, stored only in GCP Secret Manager
- [ ] License key: store SHA-256 hash only — never plaintext
- [ ] JWT `sub`: opaque 16-char hash of userId — no raw identifiers in claims
- [ ] Supabase RLS: all tables have policies — no row accessible without auth context
- [ ] Dual-fulfillment: success page + webhook both call idempotent `fulfillCheckout()`
- [ ] Trial anti-abuse: email verification + per-user + per-domain (DB unique index) + IP rate limit
- [ ] CSP headers on all pages

---

## A.14 — Gate Verification

Before calling Phase A complete:

- [ ] Stripe test mode: complete a checkout, verify JWT is issued on success page, verify webhook also fires and is idempotent
- [ ] Trial flow: sign up, verify email, get trial JWT, verify domain uniqueness index blocks second signup
- [ ] Expired JWT: modify exp in test, verify agent falls back to free mode, writes EXPIRED.txt
- [ ] Invalid JWT: tamper signature byte, verify agent emits `'error'` and continues in free mode
- [ ] Payment failure: trigger `invoice.payment_failed` in Stripe test mode, verify tier → free
- [ ] 20 paying customers reached → proceed to Phase B
