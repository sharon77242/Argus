# Project: Diagnostic SaaS Platform & License Authority

## Architecture Paradigm

This backend serves as the centralized Dashboard, License Generator, and OpenTelemetry ingestion point. It handles user authentication, Stripe payments, and cryptographic license generation.

## Phase 1: Authentication & User Management

- Implement a user authentication system (e.g., using Firebase Auth, Supabase, or standard JWT sessions).
- Users have a profile in the DB (PostgreSQL/Firestore) tracking their current plan (`free` or `premium`).

## Phase 2: Stripe Integration & Webhooks

- **Checkout:** Integrate Stripe Checkout. When a user clicks "Upgrade", generate a Stripe session.
- **Webhook:** Implement a secure Stripe webhook endpoint (`/webhooks/stripe`). Upon receiving `checkout.session.completed`, update the user's DB record to `premium`.

## Phase 3: Cryptographic License Generation (The Private Key)

- **Setup:** Generate an RSA or ECDSA key pair. Store the `PRIVATE_KEY` securely in the SaaS environment variables (e.g., Google Cloud Secret Manager).
- **Generation Endpoint:** When a premium user requests a license key, generate a JWT.
  - Payload: `{"userId": "123", "tier": "premium", "exp": <timestamp>}`
  - Sign it using the `PRIVATE_KEY`.
  - Display this JWT to the user in the UI with instructions to set it as `DIAGNOSTIC_LICENSE_KEY` in their container.

## Phase 4: Telemetry Ingestion & UI Dashboard

- **Ingestion:** Provide an endpoint to receive OpenTelemetry data originating from the user's agent.
- **Update Detection:** 1. Extract the `diagnostic_agent.version` attribute from the incoming telemetry traces. 2. Compare it against the `LATEST_AGENT_VERSION` stored in the SaaS config. 3. If the user's version is older, set a flag `needsUpdate: true` in the UI state.
- **UI:** Build a dashboard to display the telemetry insights. If `needsUpdate` is true, render a prominent banner: "Your Diagnostic Agent is outdated. Update to vX.X.X for the latest AI insights."
