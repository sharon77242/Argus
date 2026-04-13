# Phase C — Self-Hosted Docker Platform

> **Gate metric:** 10 Enterprise Compliance contracts signed.
> **Prerequisite:** Phase B stable and generating revenue.

**Delivers:** Self-Hosted Pro Docker dashboard + `@argus/ui` Team embedded components.

---

## C.1 — Docker Image Scaffold (`packages/docker/`)

### C.1.1 — Directory structure

```
packages/docker/
  docker-compose.yml        ← one file, five env vars, done
  Dockerfile
  src/
    index.ts                ← entry: runs diagnose check, then starts services
    diagnose.ts             ← pre-flight checker
    ingestor/               ← embedded OTLP ingest endpoint
    dashboard/              ← embedded Next.js dashboard (build artifact)
    ai-proxy/               ← proxies to OpenAI using customer BYOK key
  clickhouse/
    init.sql                ← same schema as Phase B
  .env.example
```

### C.1.2 — `docker-compose.yml`

```yaml
version: '3.9'
services:
  argus:
    image: ghcr.io/argus-dev/platform:latest
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "3000:3000"   # Dashboard
    environment:
      - DIAGNOSTIC_LICENSE_KEY=${DIAGNOSTIC_LICENSE_KEY}
      - ARGUS_DATA_DIR=/data
      - OPENAI_API_KEY=${OPENAI_API_KEY}        # optional — AI disabled if absent
      - ARGUS_OTLP_FORWARD_URL=${ARGUS_OTLP_FORWARD_URL}  # optional — forward to external
    volumes:
      - argus-data:/data   # persistent: ClickHouse data + clock guard state
    restart: unless-stopped

  clickhouse:
    image: clickhouse/clickhouse-server:24-alpine
    volumes:
      - argus-data:/var/lib/clickhouse
      - ./clickhouse/init.sql:/docker-entrypoint-initdb.d/init.sql
    environment:
      - CLICKHOUSE_DB=argus
    restart: unless-stopped

volumes:
  argus-data:
```

### C.1.3 — `.env.example`

```bash
# Required
DIAGNOSTIC_LICENSE_KEY=eyJ...   # Self-Hosted Pro annual JWT from argus.dev/account/license

# Optional — AI suggestions disabled if absent (BYOK)
OPENAI_API_KEY=sk-...

# Optional — forward a copy of traces to external OTLP (Jaeger, Datadog, etc.)
ARGUS_OTLP_FORWARD_URL=https://your-otel-collector:4318
```

---

## C.2 — `diagnose` Command

Runs before the main process. Checks everything and reports clearly. Written before the feature documentation — this is the correct priority order.

### C.2.1 — `src/diagnose.ts`

```ts
interface Check {
  name:   string;
  run:    () => Promise<'ok' | 'warn' | 'fail'>;
  detail: string;
  fix?:   string;
}

const checks: Check[] = [
  {
    name:   'License key',
    run:    async () => {
      if (!process.env.DIAGNOSTIC_LICENSE_KEY) return 'fail';
      try { validateLicense(process.env.DIAGNOSTIC_LICENSE_KEY); return 'ok'; }
      catch (e) { return 'fail'; }
    },
    detail: 'DIAGNOSTIC_LICENSE_KEY must be a valid Self-Hosted Pro JWT',
    fix:    'Get your key at: https://argus.dev/account/license',
  },
  {
    name:   'ClickHouse write',
    run:    async () => {
      try { await clickhouse.ping(); return 'ok'; }
      catch { return 'fail'; }
    },
    detail: 'ClickHouse must be reachable',
    fix:    'Check docker-compose logs for the clickhouse service',
  },
  {
    name:   'OTLP endpoint',
    run:    async () => {
      // attempt a test POST to localhost:4318
      try { await fetch('http://localhost:4318/v1/traces', { method: 'POST', body: '{}' }); return 'ok'; }
      catch { return 'fail'; }
    },
    detail: 'OTLP HTTP endpoint must be listening on port 4318',
  },
  {
    name:   'Outbound HTTPS (port 443)',
    run:    async () => {
      try { await fetch('https://ifconfig.me'); return 'ok'; }
      catch { return 'warn'; }
    },
    detail: 'Outbound HTTPS needed for AI suggestions and optional OTLP forwarding',
    fix:    'AI suggestions will be disabled. Configure HTTPS_PROXY or OPENAI_BASE_URL if behind a corporate proxy.',
  },
  {
    name:   'OpenAI API',
    run:    async () => {
      if (!process.env.OPENAI_API_KEY) return 'warn';
      try { await openai.models.list(); return 'ok'; }
      catch { return 'warn'; }
    },
    detail: 'OpenAI API key is required for AI fix suggestions (BYOK)',
    fix:    'Set OPENAI_API_KEY in your .env file. All other features work without it.',
  },
  {
    name:   'Persistent volume',
    run:    async () => {
      try {
        await fs.writeFile('/data/.probe', 'ok');
        await fs.unlink('/data/.probe');
        return 'ok';
      } catch { return 'warn'; }
    },
    detail: 'Persistent volume at /data required for data retention across restarts',
    fix:    'Add a Docker volume mount for /data in your docker-compose.yml',
  },
];

export async function runDiagnose(): Promise<boolean> {
  let allOk = true;
  for (const check of checks) {
    const result = await check.run();
    const icon   = result === 'ok' ? '✅' : result === 'warn' ? '⚠️' : '❌';
    console.log(`${icon} ${check.name}`);
    if (result !== 'ok') {
      console.log(`   ${check.detail}`);
      if (check.fix) console.log(`   → ${check.fix}`);
    }
    if (result === 'fail') allOk = false;
  }
  return allOk;
}
```

### C.2.2 — Structured failure output (for SaaS conversion)

When a check fails with `self_hosted_viable: false`, output JSON to stderr alongside human-readable to stdout:

```ts
process.stderr.write(JSON.stringify({
  status:              'failed',
  check:               'otlp_export',
  reason:              'Corporate proxy blocking port 443',
  self_hosted_viable:  false,
  saas_alternative: {
    message:   'The hosted platform bypasses local networking entirely.',
    trial_url: 'https://argus.dev/trial?ref=diagnose_fail&reason=proxy',
  },
}) + '\n');
```

The `ref` and `reason` params are tracked in analytics to understand which failure modes drive SaaS conversions.

---

## C.3 — Embedded Ingestor

```ts
// src/ingestor/index.ts
// Accepts OTLP HTTP payloads from the customer's agents
// Validates license JWT (offline ECDSA — same as cloud ingestor)
// Writes to embedded ClickHouse

app.post('/v1/traces', async (req, reply) => {
  const jwt    = req.headers.authorization?.replace('Bearer ', '');
  const claims = validateLicense(jwt ?? '');

  // Self-hosted: only accept self-hosted-pro and enterprise tiers
  if (!['self-hosted-pro', 'enterprise'].includes(claims.tier)) {
    return reply.code(403).send({ error: 'USE_SAAS_ENDPOINT' });
  }

  await clickhouse.insert({ table: 'telemetry_events', values: [...] });

  // Optional forward (fire-and-forget)
  if (ARGUS_OTLP_FORWARD_URL) {
    fetch(ARGUS_OTLP_FORWARD_URL, { method: 'POST', body: req.rawBody }).catch(() => {});
  }

  reply.send({ received: true });
});
```

---

## C.4 — Embedded Dashboard

The Next.js dashboard from Phase B is built as a static export and embedded in the Docker image.

### C.4.1 — Build process

```bash
# In packages/saas — build dashboard-only subset
ARGUS_MODE=self-hosted pnpm build:dashboard
# Outputs to packages/saas/out/dashboard/
```

Environment toggle `ARGUS_MODE=self-hosted` disables:
- Ingestion pipeline pages (not needed — handled by embedded ingestor)
- Subscription management (billing managed at argus.dev)
- Team/Pro features gated by JWT tier

### C.4.2 — Serve embedded dashboard

```ts
// src/index.ts
import next from 'next';
const app = next({ dir: './dashboard', dev: false });
app.prepare().then(() => {
  const handle = app.getRequestHandler();
  server.get('*', (req, reply) => handle(req.raw, reply.raw));
});
```

---

## C.5 — AI Proxy (BYOK)

```ts
// src/ai-proxy/index.ts
// Receives analysis requests from the embedded dashboard
// Proxies to OpenAI using customer's OPENAI_API_KEY
// Never uses Argus's own OpenAI quota

app.post('/ai/analyze', async (req, reply) => {
  if (!process.env.OPENAI_API_KEY) {
    return reply.code(503).send({
      error: 'AI_NOT_CONFIGURED',
      message: 'Set OPENAI_API_KEY in .env to enable AI suggestions.',
    });
  }

  const { sanitizedQuery, context } = req.body;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [...] });
  reply.send({ suggestions: parseSuggestions(result) });
});
```

---

## C.6 — GitHub Container Registry Publish

### C.6.1 — Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY clickhouse ./clickhouse
EXPOSE 3000 4317 4318
ENTRYPOINT ["node", "dist/index.js"]
CMD ["start"]
```

### C.6.2 — GitHub Actions workflow

```yaml
# .github/workflows/docker-publish.yml
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - run: |
          docker build -t ghcr.io/argus-dev/platform:${{ github.ref_name }} packages/docker
          docker push ghcr.io/argus-dev/platform:${{ github.ref_name }}
          docker tag ghcr.io/argus-dev/platform:${{ github.ref_name }} ghcr.io/argus-dev/platform:latest
          docker push ghcr.io/argus-dev/platform:latest
```

---

## C.7 — `@argus/ui` — Team Tier Embedded Components

### C.7.1 — Scaffold (`packages/ui/`)

```bash
cd packages/ui
pnpm add react react-dom @tanstack/react-query recharts
pnpm add -D @types/react typescript tsup
```

### C.7.2 — Components

```ts
// packages/ui/src/index.ts
export { ArgusAnomalyTimeline }  from './components/AnomalyTimeline';
export { ArgusQueryTable }       from './components/QueryTable';
export { ArgusEventFeed }        from './components/EventFeed';
export { ArgusProvider }         from './components/Provider';

// Provider accepts an API key and base URL — all data fetched from /api/v1/
// <ArgusProvider apiKey="ak_..." baseUrl="https://argus.dev">
//   <ArgusAnomalyTimeline service="my-api" window="24h" />
// </ArgusProvider>
```

### C.7.3 — Build and publish

```bash
cd packages/ui
tsup src/index.ts --format esm,cjs --dts
npm publish --access public
```

Published as `@argus/ui`. Consumers: Team tier customers embedding dashboards in their own internal tooling.

---

## C.8 — Supported Configurations (Hard Boundary)

```
✅ Supported:
   - Docker 24.0+ on Linux (amd64, arm64)
   - Docker Compose 2.x
   - Outbound HTTPS on port 443 (for AI + optional OTLP forward)

❌ Not supported in Phase C (Phase D roadmap):
   - Windows containers
   - Kubernetes / Helm
   - Custom internal Docker registries
   - Rootless Docker with user namespace remapping
```

"Not supported" = the support ticket is not taken. Kubernetes + custom registry = Enterprise Compliance customer.

---

## C.9 — Gate Verification

- [ ] `docker compose up` produces a running dashboard at `localhost:3000` with a valid license key
- [ ] `diagnose` command prints clear pass/fail for all 6 checks
- [ ] Agent in a separate container can POST OTLP to `localhost:4318` and events appear in dashboard
- [ ] Expired license: agent logs expiry, dashboard shows "license expired" banner
- [ ] OPENAI_API_KEY absent: dashboard shows "AI not configured" — all other features work
- [ ] Volume mount: data persists across `docker compose down && docker compose up`
- [ ] 10 Enterprise contracts signed → proceed to Phase D
