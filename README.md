# Salon Recovery Agent

An AI-assisted revenue recovery and operations platform for salons. It identifies missed-revenue opportunities, coordinates customer follow-up across messaging channels, and keeps sensitive actions behind explicit policy and human-approval boundaries.

## What it demonstrates

- Recovery workflows for abandoned bookings, cancellations, waitlists, lapsed clients, no-shows, and post-visit rebooking
- A multi-tenant React operations dashboard with queues, conversations, approvals, revenue attribution, onboarding, and health views
- A TypeScript/Fastify backend with PostgreSQL, durable workflows, transactional outbox delivery, idempotency, and tamper-evident audit records
- OpenAI-powered conversation orchestration with deterministic safety routing, grounded booking tools, prompt versioning, and a 150-case golden evaluation gate
- Square booking and OAuth integration, Twilio SMS/WhatsApp/voice webhooks, Stripe billing, and Postmark email delivery
- Production controls including OIDC authentication, MFA policy enforcement, rate limiting, webhook verification, encrypted credentials, circuit breakers, and provider reconciliation
- A single immutable container image deployed as separate API, webhook, and worker services, with an AWS Terraform baseline and GitHub Actions release gate

## Stack

TypeScript, React 19, Vite, Fastify, PostgreSQL, OpenAI, Square, Twilio, Stripe, Docker, Terraform, Vitest, and GitHub Actions.

## Run locally

Requirements: Node.js 22.23.1 and npm.

```bash
npm ci
cp .env.example .env
npm run dev
```

The frontend development server starts through Vite. Run the API separately when exercising backend routes:

```bash
npm run dev:api
```

Without `DATABASE_URL`, the backend uses its isolated in-memory adapter for local development and tests. Provider credentials are optional unless you intentionally run a sandbox integration command.

## Verify the release candidate

```bash
npm test
npm run build
npm run release:validate:local
docker build -t salon-recovery-agent:local .
```

The local release gate runs the deterministic contracts and golden agent evaluation without making model or provider calls. Full release validation is intentionally reserved for a protected environment with controlled sandbox credentials.

## Architecture

```text
React dashboard
      |
Fastify API ---- PostgreSQL (tenant data, audit, outbox)
      |
Durable workflow worker ---- OpenAI / Square / Twilio / Stripe / Postmark
      |
Webhook ingester ----------- verified provider callbacks
```

The API, webhook ingester, and workflow worker are built from the same pinned image but deployed as independently scalable services. Business mutations carry tenant and location scope through the final write boundary, while external side effects use idempotency and reconciliation controls.

## Documentation

- [Backend and domain contracts](server/README.md)
- [Production runtime](deploy/README.md)
- [Terraform baseline](infra/terraform/README.md)
- [Security policy](SECURITY.md)

All committed examples and tests use synthetic data. Secrets belong in local environment files or a deployment secret manager and are excluded from source control.
