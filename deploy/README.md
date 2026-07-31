# Production service image contract

Build one immutable image and deploy that exact digest as three independent services. Do not rebuild between service deployments.

```sh
docker build \
  --build-arg VITE_TURNSTILE_SITE_KEY=<public-site-key> \
  --build-arg VITE_OIDC_AUTHORITY=https://identity.example \
  --build-arg VITE_OIDC_CLIENT_ID=<public-client-id> \
  --build-arg VITE_OIDC_REDIRECT_URI=https://salon-recovery.example/app/auth/callback \
  --build-arg VITE_OIDC_POST_LOGOUT_REDIRECT_URI=https://salon-recovery.example/app \
  --build-arg VITE_OIDC_SCOPE="openid profile email salon:operations" \
  --build-arg VITE_OIDC_RESOURCE=https://api.salon-recovery.example \
  -t salon-recovery-agent:<release-id> .
```

The Dockerfile pins Node `22.23.1-bookworm-slim` to the exact official multi-architecture manifest digest. Base-image changes therefore require a reviewed source update and a fresh release gate instead of silently entering a rebuild.

| Service | Command | Port | Liveness | Readiness |
|---|---|---:|---|---|
| Web API | `node dist-server/index.js` | 4100 | `/livez` | `/readyz` |
| Webhook ingester | `node dist-server/webhook-index.js` | 4200 | `/livez` | `/readyz` |
| Workflow worker | `node dist-server/workflow-index.js` | 4300 | `/livez` | `/readyz` |

The API and webhook readiness probes execute a bounded PostgreSQL `SELECT 1` through the shared store. The worker also fails readiness when a workflow tick remains in progress beyond `WORKER_STALL_MS`. Liveness is process-only so a dependency outage removes tasks from traffic without causing a restart loop. Probe responses are `no-store`, contain bounded service state only, and never include connection strings or provider errors.

Run the API with the image default command. Override the container command for the webhook ingester and worker. Bind `HOST`, `WEBHOOK_HOST`, and `WORKER_HEALTH_HOST` to `0.0.0.0` in the task definitions; the repository defaults remain loopback-safe for local development.

All three services require the same PostgreSQL connection and credential-encryption key. A connection may be supplied as `DATABASE_URL`, or through standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PGSSLMODE` variables. The latter is preferred on ECS because RDS-managed username/password fields can be injected directly without constructing a credential-bearing URL. Give the public load balancer routes only to the API and webhook ingester; the worker health port is for the orchestrator inside the private network. Route provider callback paths to the webhook ingester, never the API task. Store secrets in the deployment secret manager rather than task-definition plaintext.

In production, the API process also serves the packaged frontend from `dist`: extensionless dashboard routes receive the application shell, fingerprinted `/assets/*` files receive immutable caching, and API, OAuth, public, and health prefixes retain their server-owned routing. The production [Terraform baseline](../infra/terraform/README.md) implements this contract across two availability zones and keeps services disabled until the one-off migration succeeds.

The frontend image build requires the public `VITE_TURNSTILE_SITE_KEY` argument. The API task separately requires `TURNSTILE_SECRET_KEY` and `TURNSTILE_EXPECTED_HOSTNAMES`; the secret key must exist only in the runtime secret manager. Production refuses to start without the server-side settings, and every accepted public recovery-review request must pass a single-use `recovery_review` challenge for an allowed hostname. Keep the existing origin or edge rate limit in addition to this application control.

The protected operations dashboard also requires the public OIDC build arguments shown above. Follow the [dashboard authentication runbook](dashboard-authentication.md) to register the exact callback URLs, align the browser authority with the API verifier, configure CSP, and run the fail-closed preflight. These values are public application metadata; client secrets and bearer tokens must never enter the image build.

Route the dashboard's same-origin `/v1` requests to the API service at the load balancer or edge proxy. Leave `VITE_API_BASE_URL` empty unless it is set to that same public origin. The current protected browser contract deliberately rejects a separate API origin rather than depending on permissive cross-origin policy.

The authenticated dashboard follows the [verified data boundary](verified-dashboard-data.md): each screen shows tenant-scoped API evidence, a verified-empty state, or an explicit failure. Development fixtures must never survive a production request failure, recovered revenue must remain separated by currency, and unsupported mutations stay unavailable until an audited API contract exists.

Each location must also publish the [authoritative communication policy](communication-policy.md). It controls disclosure evidence, escalation ownership, local contact hours, and the default rebooking interval; onboarding fails closed while the policy is absent.

Monitor tenant-safe [operational health and backpressure signals](operational-health.md) for event-outbox lag, due-workflow saturation, abandoned leases, and agent-release drift. These checks are diagnostic only and preserve the durable queue as the source of truth.

Terminal workflow failures enter the immutable [workflow dead-letter ledger](workflow-dead-letters.md) atomically with their approval request. Reconcile uncertain provider outcomes before a manager approves any replay; prior failure evidence is retained after every decision.

Collect the production services' [PII-safe operational telemetry](observability.md) from standard output through the configured encrypted CloudWatch log groups. Correlate with validated `X-Request-ID` values; raw URLs, headers, bodies, destinations, IP addresses, exception messages, and provider payloads are intentionally absent.

Send `SIGTERM` during rolling deployment. Each HTTP service stops accepting new traffic, drains Fastify, closes its database pool, and exits. The worker first marks itself unready, stops polling, closes its health listener, waits up to `WORKER_SHUTDOWN_GRACE_MS` for an active tick, and then closes the database pool. Set the orchestrator's termination grace period above that value. Workflow leases and idempotency controls remain the recovery boundary if the grace period expires during provider I/O.

Before promoting an image digest, run `npm run release:validate`; a local-only pass is not production evidence. Database migrations should run as a separate one-shot task before the service rollout, using the same image and `npm run db:migrate:prod`. The image copies the numbered SQL files beside the compiled migration runner; it does not retain `tsx` or other development dependencies.

Activate the evaluated, code-managed conversation prompt through the [prompt release runbook](prompt-release.md) before routing production messages or running a location's final onboarding simulation. Prompt activation is a separate protected mutation: a passing release validator does not silently switch the active prompt.

Security events are handled under the [incident response runbook](incident-response.md). Operators must preserve evidence outside application text fields, declare the incident through the management API, contain the affected workflow or credential, reconcile provider state, and obtain owner-only closure before treating the event as resolved.

Protected releases also follow the [security governance review procedure](security-governance.md). Dependency and privileged-access reviews expire after 93 days. Enterprise-mode releases additionally require independent penetration-test evidence from the last 366 days. The release validator handles only opaque references and freshness metadata.

## Pull-request release gate

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual dispatch. It has read-only repository permission, disables persisted checkout credentials and package-manager caching, installs only the lockfile graph, runs the complete local release validator, and builds the pinned production image. It receives no provider, cloud, database, or registry secrets and has no push or deployment permission.

Both GitHub-authored actions are pinned to the full commit IDs for their immutable `v7.0.0` releases. Dependabot proposes weekly npm and GitHub Actions updates; those proposals pass through the same tests and image build. Branch protection should require the `Contracts, golden eval, build, and image` check before merge. The full external release validator remains a separate protected-environment operation because it uses provider sandbox mutations and controlled credentials.
