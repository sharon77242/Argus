# Phase D — Alerts & Integrations

> **Gate metric:** Measurable reduction in monthly churn rate vs. Phase B baseline.
> **Prerequisite:** Phase B revenue stable. Phase C Docker image shipped.

Alerts are a **retention mechanism, not a growth mechanism.** Every integration that embeds Argus into a team's operational workflow raises the switching cost. Build this only when there are customers to retain.

---

## D.1 — Email Alerts

Lowest complexity. Highest immediate stickiness. Build first.

### D.1.1 — Supabase schema

```sql
create table public.alert_configs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references profiles(id) on delete cascade,
  event_types  text[] not null default '{crash,anomaly,leak}',
  emails       text[] not null,   -- alert destination addresses
  enabled      boolean default true,
  created_at   timestamptz default now()
);
```

### D.1.2 — Trigger in worker

In `packages/saas/worker/src/index.ts`, after ClickHouse write:

```ts
if (['crash', 'anomaly', 'leak'].includes(event.eventType)) {
  await maybeSendAlertEmail(claims.sub, event);
}
```

### D.1.3 — `maybeSendAlertEmail`

```ts
async function maybeSendAlertEmail(userSub: string, event: TelemetryEvent) {
  const config = await getAlertConfig(userSub);
  if (!config?.enabled) return;
  if (!config.event_types.includes(event.eventType)) return;

  await resend.emails.send({
    from:    'Argus Alerts <alerts@argus.dev>',
    to:      config.emails,
    subject: `[Argus] ${event.eventType} in ${event.serviceName}`,
    html:    buildAlertEmail(event),
  });
}
```

### D.1.4 — Alert config UI

`app/dashboard/settings/alerts/page.tsx`:
- Toggle alert types (crash / anomaly / leak)
- Email addresses list (add / remove)
- Test alert button → fires a synthetic event

---

## D.2 — Slack Integration

### D.2.1 — Setup flow

1. User clicks "Connect Slack" in dashboard
2. OAuth flow → Slack app installation → save `webhook_url` per user
3. Store encrypted in Supabase `alert_configs.slack_webhook_url`

### D.2.2 — Supabase schema addition

```sql
alter table public.alert_configs
  add column slack_webhook_url text,   -- encrypted at rest
  add column slack_enabled     boolean default false;
```

### D.2.3 — Send Slack notification

```ts
async function sendSlackAlert(webhookUrl: string, event: TelemetryEvent) {
  await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      text: `*${event.eventType.toUpperCase()}* in \`${event.serviceName}\``,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: buildSlackMessage(event) },
          accessory: {
            type:     'button',
            text:     { type: 'plain_text', text: 'View on Argus' },
            url:      `https://argus.dev/dashboard/${event.eventType}s`,
            style:    'primary',
          },
        },
      ],
    }),
  });
}
```

---

## D.3 — PagerDuty Integration

Enterprise stickiness mechanism. Once wired into incident response, cancellation requires a deliberate policy decision.

### D.3.1 — Setup flow

1. User provides PagerDuty integration key (Events API v2)
2. Store encrypted in `alert_configs.pagerduty_routing_key`

### D.3.2 — Send PagerDuty event

```ts
async function sendPagerDutyAlert(routingKey: string, event: TelemetryEvent) {
  await fetch('https://events.pagerduty.com/v2/enqueue', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      routing_key:  routingKey,
      event_action: 'trigger',
      dedup_key:    `argus-${event.eventType}-${event.serviceName}-${event.id}`,
      payload: {
        summary:   `Argus: ${event.eventType} in ${event.serviceName}`,
        severity:  event.eventType === 'crash' ? 'critical' : 'warning',
        source:    'argus',
        timestamp: event.receivedAt,
        custom_details: {
          service:    event.serviceName,
          event_type: event.eventType,
          dashboard:  `https://argus.dev/dashboard/${event.eventType}s`,
        },
      },
    }),
  });
}
```

---

## D.4 — Custom Webhooks UI

The webhook API is already built in Phase B (`/api/v1/webhooks`). Phase D adds the dashboard configuration UI and HMAC signing.

### D.4.1 — `app/dashboard/settings/webhooks/page.tsx`

- List registered webhook endpoints
- Add new endpoint (URL + secret)
- Toggle per endpoint
- "Test webhook" button → sends synthetic payload

### D.4.2 — HMAC-SHA256 signing

```ts
function signWebhookPayload(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

// Delivery with retry (1s → 4s → 16s)
async function deliverWebhook(endpoint: WebhookEndpoint, event: TelemetryEvent) {
  const payload   = JSON.stringify({ event, timestamp: Date.now() });
  const signature = signWebhookPayload(payload, endpoint.secret);

  const delays = [0, 1000, 4000, 16000];
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    try {
      const res = await fetch(endpoint.url, {
        method:  'POST',
        headers: {
          'Content-Type':       'application/json',
          'X-Argus-Signature':  signature,
          'X-Argus-Timestamp':  String(Date.now()),
        },
        body:    payload,
        signal:  AbortSignal.timeout(5000),
      });
      if (res.ok) return; // delivered
    } catch {
      // retry
    }
  }
  // All 3 retries failed — log delivery failure to Supabase
  await logWebhookFailure(endpoint.id, event.id);
}
```

---

## D.5 — Alert Dispatch Router

Central dispatch in the worker — called after every ClickHouse write for alertable event types:

```ts
// packages/saas/worker/src/alerting/router.ts

async function dispatchAlerts(userSub: string, event: TelemetryEvent) {
  const config = await getAlertConfig(userSub);
  if (!config?.enabled) return;
  if (!config.event_types.includes(event.eventType)) return;

  await Promise.allSettled([
    config.emails?.length      ? sendEmailAlert(config.emails, event)             : null,
    config.slack_enabled       ? sendSlackAlert(config.slack_webhook_url!, event) : null,
    config.pagerduty_routing_key ? sendPagerDutyAlert(config.pagerduty_routing_key, event) : null,
    deliverCustomWebhooks(userSub, event),
  ].filter(Boolean));
  // Promise.allSettled — one integration failing never blocks the others
}
```

---

## D.5b — Self Code Review

Issues found and corrected:

| Issue | Location | Fix |
|---|---|---|
| `sendSlackAlert` called with `webhookUrl` stored as plaintext in `alert_configs` — webhook URLs are sensitive credentials | `alert_configs` table | Encrypt `slack_webhook_url` at rest using Supabase's `pgcrypto` extension: `pgp_sym_encrypt(url, app_secret)` on write, `pgp_sym_decrypt` on read. |
| `deliverWebhook` uses `await sleep(delay)` with hardcoded values — sleep inside a server function holds the Vercel function open | `lib/alerting/webhooks.ts` | Move retry logic to a queue (Upstash QStash or a Supabase background job). Do not sleep inline in a serverless function. Or: emit a retry job to a `webhook_retry_queue` Supabase table and process it via a cron. |
| `Promise.allSettled` in `dispatchAlerts` — a slow Slack call (5s timeout) holds up all other integrations since they all start in parallel but the function waits for all | `lib/alerting/router.ts` | Each integration call should have `AbortSignal.timeout(5000)`. Already in webhook delivery via signal param — add to Slack and PagerDuty fetch calls too. |
| `dedup_key` in PagerDuty payload uses `event.id` — but `TelemetryEvent` has no stable `id` field in the current plan | `lib/alerting/pagerduty.ts` | Add `id uuid default gen_random_uuid()` to ClickHouse events OR derive dedup key from `sha256(user_sub + event_type + service_name + floor(received_at / 300))` — deduplicates within 5-minute windows. |
| Alert dispatch triggered in worker service after ClickHouse write — but Phase D adds Slack/PagerDuty calls that can be slow. Worker's Pub/Sub ack deadline is 60s | `worker/src/index.ts` | Move alert dispatch to a separate async path: after ClickHouse write succeeds, publish a second Pub/Sub message to an `alert-events` topic. Alert delivery is a separate worker. Never block ClickHouse ack on Slack latency. |

---

## D.5c — Test Coverage Requirements

| File | What to cover |
|---|---|
| `tests/alerting/router.test.ts` | Event not in `event_types` → no alerts fired; alerts disabled → no alerts; each channel called with correct payload; one channel failing doesn't block others (`allSettled`); all have 5s timeout |
| `tests/alerting/email.test.ts` | Resend called with correct to/subject/html; alert config with no emails → no send |
| `tests/alerting/slack.test.ts` | Webhook URL set + enabled → POST to Slack URL; Slack returns 400 → error logged, not thrown; 5s timeout fires if Slack hangs |
| `tests/alerting/pagerduty.test.ts` | Integration key set → POST to PagerDuty Events API; dedup key is deterministic for same event within 5-min window; different 5-min window → different dedup key |
| `tests/alerting/webhooks.test.ts` | Success on first attempt; failure + 3 retries with correct backoff delays (1s→4s→16s); all fail → failure logged to DB; HMAC sig verifiable by recipient; replay prevention: same payload + different timestamp → different sig |
| `tests/alerting/config-ui.test.ts` | Alert config persists across page reload; test alert button fires synthetic event through full dispatch path |

---

## D.6 — Gate Verification

- [ ] Email alert fires within 30 seconds of a `crash` event arriving in ClickHouse
- [ ] Slack alert appears in test channel with "View on Argus" button
- [ ] PagerDuty incident is created, includes `dedup_key` to prevent duplicate incidents
- [ ] Custom webhook: test delivery succeeds, HMAC signature can be verified by recipient
- [ ] Custom webhook: simulated failure → 3 retries with correct backoff, failure logged
- [ ] Alert config UI: all settings persist across page reload
- [ ] Churn rate measured before and after Phase D launch — confirm reduction
