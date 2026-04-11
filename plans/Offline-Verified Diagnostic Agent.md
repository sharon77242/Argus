# Project: Offline-Verified Diagnostic Agent (Node.js/TypeScript)

## Architecture Paradigm: Zero Call-Home

This agent runs inside a user's container. It MUST NOT make any external HTTP calls for license verification. All telemetry is exported strictly via OpenTelemetry protocols.

## Phase 1: Local License Verification (Asymmetric JWT)

**Goal:** Determine user tier (Free vs. Premium) securely and completely offline.

- **Mechanism:** 1. The agent expects an environment variable: `DIAGNOSTIC_LICENSE_KEY` (which is a signed JWT). 2. Hardcode a `PUBLIC_KEY` inside the agent's source code. 3. On startup, use a lightweight JWT library (like `jose` or `jsonwebtoken`) to verify the token's signature using the `PUBLIC_KEY`.
- **Logic:**
  - If the token is missing, invalid, or expired -> `tier = 'free'`. Log: "[Diagnostic Agent] Running in Free Mode."
  - If verification passes and payload contains `tier: 'premium'` -> `tier = 'premium'`.
- **Security:** Never expose or require the Private Key here.

## Phase 2: Feature Flagging & Data Collection

**Goal:** Restrict data extraction based on the verified tier.

- **Free Tier:** Collect baseline metrics (Event loop lag timing, memory usage). Strip all contextual code, source maps, and query structures.
- **Premium Tier:** Enable deep AST resolution, source-map tracking, and exact query plan extraction (always sanitizing PII).

## Phase 3: Telemetry Export & Versioning

**Goal:** Send data to the OpenTelemetry Collector, including version info for update prompts.

- Read the agent's version from `package.json` at startup.
- When exporting traces/metrics via the OpenTelemetry SDK, attach a custom resource attribute: `telemetry.sdk.version` or a custom `diagnostic_agent.version`.
- The exported payload is the ONLY data leaving the system.
