# Salon Recovery API foundation

This server implements the first deterministic slice of the production blueprint:

- tenant and location context resolved before every business route;
- channel-and-purpose consent records with immediate opt-out enforcement and atomic evidence;
- immutable domain events and an outbox with `eventId` deduplication;
- temporary appointment holds and explicit-confirmation booking writes;
- price, token, expiry, client, tenant, and idempotency validation;
- immutable audit records for consent and booking actions.

The API selects `PostgresStore` whenever `DATABASE_URL` is set. The foundation migration creates tenant-scoped consent, hold, booking, event, outbox, audit, idempotency, and integration-account tables. `MemoryStore` remains the isolated test and local fallback adapter.

Every consent transition commits its latest channel/purpose state, immutable `consent.recorded` or `consent.revoked` domain event, outbox entry, and PII-safe chained audit as one transaction. Event or audit evidence collisions roll the entire transition back, so an opt-out cannot take effect without durable provenance and a failed evidence append cannot overwrite the previously enforceable state. Source evidence URLs are retained only on the operational consent record and replaced with a redacted marker in the audit ledger.

Repository mutations carry the authenticated tenant and location through the final write predicate. Workflow completion and reservation validate the full claimed job scope, recovery and review completion requires an explicit `TenantContext`, and nested waitlist and recovery transactions repeat the scope on child updates. Event idempotency, appointment holds, revenue attribution, and ID-based upserts reject cross-scope collisions instead of returning or mutating another salon's record. `repository-isolation-contract.test.ts` exercises the in-memory boundary and locks the corresponding PostgreSQL predicates against regression.

Square support is sandbox-first and pins API version `2026-07-15`. The connector disables blind SDK retries for booking writes, while the webhook route verifies Square's raw-body HMAC-SHA256 signature before storing and deduplicating the original notification.

Square OAuth initiation is owner/manager-only at the service boundary and uses a tenant-bound, single-use state that expires after five minutes. The callback atomically consumes that state before exchanging the code through the tenant/location Square circuit, with SDK retries disabled and an eight-second timeout. A failed or circuit-blocked exchange cannot reuse its authorization state; the operator must restart OAuth. After a successful exchange, credential persistence, previous-location-account revocation, scoped workflow resume, the chained `integration.square_connected` audit record, and the immutable `integration.connected` outbox event commit in one database transaction or all roll back. Evidence contains only provider, account identifier, active status, and the number of resumed workflows—never authorization codes, OAuth state, credentials, or provider responses. A partial unique route index prevents one active Square merchant from resolving to multiple tenants or locations. Access and refresh tokens are AES-256-GCM encrypted at rest; production requires `CREDENTIAL_ENCRYPTION_KEY_BASE64` containing exactly 32 random bytes. Configure `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, and `SQUARE_OAUTH_REDIRECT_URI`, then use:

- `GET /v1/integrations/square/oauth/start` to obtain the seller authorization URL;
- `GET /oauth/square/callback` as the configured Square redirect;
- `POST /v1/integrations/square/sync` to refresh the tenant's services and bookable staff;
- `GET /v1/services` and `GET /v1/staff` to read the normalized tenant snapshot.
- `POST /v1/availability/search` to retrieve provider-confirmed slots for a synchronized service.

The sync rejects expired connections before calling Square and protects the parallel service/staff reads with the shared Square circuit. It validates every normalized record against the authenticated tenant/location before writing, then replaces both provider snapshots under one PostgreSQL advisory lock and transaction. The new service snapshot, staff snapshot, and chained `integration.square_synced` audit commit together; an audit collision or database failure preserves the complete previous catalog instead of exposing unaudited prices, a mixed service/staff version, or partial evidence.

To create a Square-backed hold, send `provider: "square"` and the imported `providerCustomerId` to `POST /v1/holds`. The API rechecks the exact service, staff member, start time, synchronized price, provider service version, and duration before issuing the ten-minute hold. SMS and WhatsApp conversations also bind their channel to the hold; that immutable notification channel follows the completed booking and any later reschedule reminder. Hold state, the immutable `appointment.hold_created` outbox event, and its chained audit commit atomically; confirmation tokens never enter event or audit evidence, and contact/provider customer fields are redacted from the ledger. `POST /v1/bookings` then claims that hold atomically and sends its idempotency key to Square before committing the local booking, completed hold state, idempotency record, immutable `appointment.booked` outbox event, and chained audit in one database transaction. Migration `049_location_scoped_booking_idempotency.sql` scopes each key by authenticated tenant and location. A retry returns the original result only when the hold, client, confirmation token, price, currency, and waitlist offer still match; reusing the key for different booking inputs fails closed. A transient Square create failure is recorded as an uncertain outcome without releasing the hold or a linked waitlist offer. An exact retry first queries Square by the authoritative customer, location, staff, and bounded start-time window; it commits an exact remote match, fails closed on ambiguity, or only then reuses the same Square idempotency key when no match exists. The uncertain claim remains reconcilable after its original hold deadline and is removed atomically when booking completion succeeds. Cancellation and rescheduling similarly persist a tenant/location-scoped mutation claim before calling Square. Only a SHA-256 request digest and the non-secret mutation target are stored, conflicting requests fail closed, and every attempt retrieves the exact provider booking first. A lost provider response or local-commit crash therefore remains safely retryable: an already-applied exact result is committed locally without a second mutation, while provider drift remains unresolved for investigation. Definite pre-mutation failures release the claim; successful booking mutation, idempotency, event, and audit evidence clear it in one transaction. An event, audit, booking, or idempotency collision rolls the whole local completion back and preserves the relevant claim for reconciliation or a safe retry. Local-only booking is disabled when `NODE_ENV=production`.

Customer-confirmed Square cancellation and rescheduling use the same evidence boundary: the updated booking, mutation idempotency key, immutable `appointment.cancelled` or `appointment.rescheduled` event, outbox entry, and PII-safe chained audit commit together. A missing scoped booking or any evidence collision leaves the prior appointment state unchanged locally, allowing provider reconciliation to surface any external/local divergence.

Square cancellation and rescheduling are provider-backed but cannot be triggered by caller-supplied confirmation flags. The legacy direct mutation routes return `CUSTOMER_CONFIRMATION_REQUIRED`. An operator prepares the change against a verified conversation, sends the exact generated summary, and deterministic code executes only after the action-specific customer reply. Rescheduling rechecks and temporarily holds the replacement slot; both mutations send Square's current booking version for optimistic concurrency. Cancelled, declined, and no-show bookings cannot be mutated again.

When an OAuth token is expired or within five minutes of expiry, every Square integration path refreshes it server-side before continuing. Refresh ownership is serialized by a tenant/location-scoped database row lock, and expiry is checked again after the lock is acquired, so concurrent replicas reuse one rotation instead of racing provider refresh calls. The outbound refresh runs through the shared Square circuit. The replica that actually rotates the credentials commits the encrypted account update and a chained, credential-free `integration.square_token_refreshed` audit record in the same transaction; waiting replicas reuse that result without writing duplicate evidence. If OAuth application credentials are unavailable or refresh fails, an interactive provider operation fails closed and one deduplicated integration-reconnect approval is opened atomically with its immutable `approval.requested` outbox event. Repeated failures refresh the existing pending approval without emitting duplicate events. A workflow-originated operation is durably paused with an `integration:square:` reason instead of consuming its retry budget or entering the dead-letter ledger. A successful tenant-bound OAuth exchange resumes only that location's Square-paused jobs; billing-, onboarding-, and other-provider pauses remain untouched.

Tenant health and onboarding do not treat an `active` database flag as sufficient by itself. The `square_connection` check blocks on an expired or invalid token expiry, any Square-paused workflow, or a pending Square reconnect approval created at or after the latest successful account update. Older unresolved approval evidence remains visible in the approval inbox but does not falsely block a location that has subsequently reconnected.

The development bearer format is:

```text
Authorization: Bearer dev:<tenantId>:<locationId>:<userId>:<role>
```

Development bearer strings are rejected when `NODE_ENV=production`.

## Production tenant authentication

Protected API routes accept signed OIDC access tokens from Clerk, Auth0, or another standards-compatible identity provider. Configure `AUTH_JWKS_URL`, `AUTH_ISSUER`, and `AUTH_AUDIENCE`. The verifier fetches and caches the remote JWKS, pins `AUTH_ALLOWED_ALGORITHMS` to asymmetric algorithms (`RS256` by default), and requires a valid signature, issuer, audience, expiry, and issued-at time. Production JWKS URLs must use HTTPS and cannot contain credentials.

The React operations dashboard uses the same provider through Authorization Code with PKCE. It is a public browser client with no client secret, stores both transaction state and user state in `sessionStorage`, and removes callback parameters after validation. Configure its public `VITE_OIDC_*` build values using `deploy/dashboard-authentication.md`. `npm run auth:preflight` verifies HTTPS, fixed same-origin callbacks, issuer alignment, an `openid` scope, backend verifier settings, and the absence of a development bearer before a full release can become eligible.

Tenant context is derived only from verified claims. The default paths are `tenant_id`, `location_id`, `sub`, and `role`; `AUTH_TENANT_CLAIM`, `AUTH_LOCATION_CLAIM`, `AUTH_USER_CLAIM`, and `AUTH_ROLE_CLAIM` support safe dot paths for nested provider claims. Role-value variables map provider roles to `owner`, `manager`, `operator`, or `service`, and overlapping mappings fail configuration. Missing or malformed tenant claims fail authentication before any store query. Unsupported roles receive a forbidden response before route execution.

Production also requires MFA evidence for `owner` and `manager` sessions before tenant context is admitted. The verifier accepts an explicit allowlisted `mfa` marker, multiple distinct `amr` authentication methods containing an allowlisted factor, or an exact provider-specific `acr` assurance string; a lone `otp` or password method is insufficient. Missing, malformed, or weaker evidence returns `403 MFA_REQUIRED`. `AUTH_MFA_AMR_CLAIM` and `AUTH_MFA_ACR_CLAIM` support the same safe nested paths as tenant claims, while `AUTH_MFA_AMR_VALUES`, `AUTH_MFA_ACR_VALUES`, and `AUTH_MFA_REQUIRED_ROLES` define exact allowlists. The default factor values support common OTP, hardware-key, and software-key evidence. Production enforcement cannot be disabled with `AUTH_MFA_REQUIRED=false`; non-production may enable the same check for integration testing. Operator and service roles remain outside the default administrator policy.

`AUTH_CLOCK_TOLERANCE_SECONDS` defaults to 30 seconds and `AUTH_MAX_TOKEN_AGE_SECONDS` defaults to one hour. Configuration errors fail closed with `AUTH_CONFIGURATION_ERROR`; signature or registered-claim failures return the same non-sensitive `UNAUTHENTICATED` response. Model-supplied and request-body tenant identifiers are never accepted by a route.

## Distributed tenant rate limits

Migration `023_tenant_rate_limits.sql` adds atomic PostgreSQL request windows scoped by tenant, location, and traffic class. Authentication resolves the tenant first; caller-supplied request data never selects the bucket. Reads and writes use independent limits so dashboard polling cannot consume booking or messaging mutation capacity. Production always enables enforcement, even if `API_RATE_LIMIT_ENABLED=false`; non-production can opt in explicitly.

Defaults are 240 reads and 60 writes per 60-second window. Configure `API_RATE_LIMIT_READ_REQUESTS`, `API_RATE_LIMIT_WRITE_REQUESTS`, and `API_RATE_LIMIT_WINDOW_SECONDS` within the validated bounds shown in `.env.example`. Accepted responses include `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`. Exceeded windows return `429 RATE_LIMIT_EXCEEDED` with `Retry-After` and remain visible in tenant health for 24 hours. The shared PostgreSQL store keeps decisions consistent across API replicas; `MemoryStore` remains test/local-only.

Consent and permission evidence, approval decisions, billing and onboarding recovery, and the operations health endpoint remain exempt after authentication so throttling cannot trap opt-outs or block restoration controls. These routes retain their existing role checks. Provider webhooks use their separate signature-verification and deduplication boundary.

## Distributed provider circuit breakers

Migrations `028_provider_circuit_breakers.sql` and `046_stripe_provider_circuit.sql` add one shared circuit per tenant, location, and external provider (`square`, `twilio`, `openai`, `postmark`, or `stripe`). The API and workflow workers use the same PostgreSQL state, so repeated dependency failures stop calls across every replica instead of creating a retry storm. Five consecutive transient failures open a circuit for 60 seconds. After the cooldown, a tenant/provider advisory lock admits one half-open probe with a 30-second lease; all other callers fail fast with `503 PROVIDER_CIRCUIT_OPEN`. A successful call closes the circuit automatically, while a failed probe starts a fresh cooldown. HTTP `408`, `425`, `429`, `5xx`, network, connection, and timeout failures count toward the circuit; reachable business/validation failures do not.

Crossing the failure threshold also opens one deduplicated `integration_reconnect` approval for that tenant, location, and provider. The approval and its immutable `approval.requested` outbox event commit atomically, so an interrupted write cannot leave an unevidenced approval or an event with no approval. The approval contains bounded circuit state, operation, and safe error code only; it never contains credentials, request payloads, provider responses, or customer data. A failed half-open probe refreshes the existing pending approval without emitting another request event. Automatic recovery closes the circuit but does not silently decide the human approval.

The breaker wraps Twilio outbound delivery, Square availability and booking mutations, OpenAI conversation routing and booking-specialist calls, Postmark weekly-report delivery, and Stripe Checkout creation. Existing workflow backoff remains the outer retry policy; the circuit decides whether the provider may be called at all. Stripe retains its caller-supplied idempotency key, eight-second SDK timeout, and disabled SDK retries while the shared circuit prevents simultaneous API replicas from amplifying an outage. Circuit records contain operational state and bounded error codes only—never credentials, request bodies, customer messages, or provider responses.

Managers can inspect `GET /v1/operations/provider-circuits`; open and half-open circuits also appear as warnings in `GET /v1/operations/health`. The health view also reports aggregate counts and the oldest age of location-scoped Square booking creations plus cancellation or reschedule claims abandoned beyond the ten-minute execution window, without returning hold, booking, customer, confirmation, request-digest, or idempotency data. Fresh in-flight mutation claims are counted separately but do not degrade health. Resolve an abandoned-claim warning by retrying the exact confirmed request or performing a bounded provider investigation; never release the claim or create a replacement booking blindly. Circuit recovery normally requires no intervention. `POST /v1/operations/provider-circuits/:provider/reset` is owner-only, requires a documented reason, and is tenant/location scoped. The reset reads the authoritative previous state under the provider lock and commits the closed circuit with its redacted, chained audit record in one transaction; an audit collision leaves the circuit open. Manual reset should be used only after independently verifying provider health because it immediately permits calls again.

`GET /v1/operations/booking-mutation-claims` is a manager-only, `no-store` evidence view for acting on that warning. It returns the local booking ID, mutation type, claim age, `in_flight` or `reconciliation_required` state, and the non-secret target time/staff for reschedules. It never returns client identity, provider booking/customer references, request digests, confirmation data, reasons, or idempotency keys. `OPERATIONS_BOOKING_MUTATION_CLAIM_STALE_MS` may tune the abandonment threshold between one minute and one hour; the default is ten minutes.

## Read-only provider reconciliation and alerts

Migration `029_provider_reconciliation.sql` adds durable tenant/location reconciliation runs. An owner or manager starts a bounded comparison through `POST /v1/operations/reconciliation-runs`, selecting `square`, `twilio`, or both and at most 50 recent records per provider. `GET /v1/operations/reconciliation-runs` returns the scoped run history. Runs contain internal entity identifiers, bounded local/provider state, finding categories, severities, counts, and safe provider error codes; they do not store customer names, destinations, message bodies, credentials, or raw provider responses.

The initial `running` record is committed before provider inspection. The terminal `completed` or `partial` result and its chained operator audit then commit in one transaction under a locked tenant/location run row. Scope, actor, timestamps, provider bounds, and summary counts are revalidated at the repository boundary; a transition conflict or audit collision rolls the terminal update back and leaves the durable run marked `running` for operational investigation.

Square reconciliation retrieves each provider-backed local booking and compares existence, status, start time, and provider version. Twilio reconciliation retrieves messages with known SIDs and compares normalized delivery status. A send reservation older than ten minutes with no provider SID is reported as an `uncertain_send`: it is never automatically resent because the first provider outcome is unknown. Provider lookup failure stops that provider's scan and marks the run `partial`; an unavailable dependency is not misreported as a data discrepancy. All provider calls retain their eight-second integration timeout and shared circuit-breaker protection.

Reconciliation is deliberately read-only. It never changes a booking, advances a delivery receipt, retries a send, or resolves a discrepancy by guessing. Verified differences are stored for review. Any critical finding opens an approval immediately; otherwise `RECONCILIATION_ALERT_FINDINGS` sets the threshold from 1–50, defaulting to 1. Alerts and their immutable request events commit atomically and are deduplicated per tenant/location/provider; a later run refreshes the pending approval with its latest run ID and category counts without emitting duplicate request evidence. Each completed run is audit chained, and tenant health warns when no run exists, the latest run is partial or contains findings, or the latest clean run is over 24 hours old.

Recommended operating procedure:

1. Run reconciliation after webhook downtime, provider incidents, deployments affecting state transitions, and at least daily in production operations.
2. Review the exact local and provider evidence in the run plus the deduplicated approval.
3. Resolve the provider or webhook cause before applying any separately authorized local correction.
4. Run reconciliation again; a recent clean run clears the health warning. Deciding the approval records the human disposition but does not itself mutate customer or provider state.

## Webhook replay and queue reliability

Migration `030_square_webhook_state.sql` adds one tenant/location cursor per Square booking. Every correctly signed provider notification is retained in the immutable provider-event ledger, while only a forward, business-valid booking transition can emit a normalized appointment event and schedule workflows. Repeated event IDs, older provider timestamps, unchanged states, and attempts to move a terminal appointment back to an active state are acknowledged without replaying customer communication. Completed appointments are terminal alongside cancellations, declines, and no-shows.

Twilio receipts follow the same monotonic rule. A delayed `sent` or `failed` callback cannot move a delivered message backward, emit a false normalized event, or open an incorrect delivery-failure approval. A legitimate transactional failure commits its deduplicated approval and `approval.requested` event in one transaction. Raw callbacks use a deterministic digest of the complete signed parameter set: exact retries deduplicate, while distinct provider evidence remains available for reconciliation without re-emitting an unchanged normalized delivery state.

Run the focused reliability contract with `npm run test:reliability`, or `npm test` for the complete suite. The focused suite covers:

- signed Square replay with exact duplicates, stale events, repeated states, and terminal regressions;
- signed Twilio delivery followed by delayed status regressions;
- generated terminal appointment-state invariants;
- two clients contending for the same provider slot;
- a 75-job queue drained in bounded batches without duplicate execution;
- recovery of a worker lease abandoned beyond five minutes.

These are deterministic local contract tests and do not require live Square or Twilio accounts. A release candidate must still pass provider sandbox smoke tests for OAuth, booking creation/cancellation, signed webhook delivery, outbound messaging, and delivery callbacks before production activation.

## Voice prerequisite: proven SMS reliability

The blueprint forbids voice calling before SMS workflows are reliable. Migration `038_messaging_reliability_evidence.sql` therefore stores immutable, location-scoped evaluations under policy `voice-prerequisite-v1`. This is a prerequisite gate only: a passing evaluation does not enable voice, place a call, authorize recording, reuse SMS consent for voice, or satisfy jurisdiction-specific disclosure and retention requirements.

An owner or manager runs `POST /v1/operations/messaging-reliability/evaluate`; `GET /v1/operations/messaging-reliability` returns the latest evidence, whether it remains current, and an explicit `voiceEnabled: false`. The fixed 30-day gate requires:

- at least 100 terminal SMS delivery outcomes;
- at least 98% delivered outcomes among terminal messages;
- zero send reservations unresolved for more than ten minutes;
- zero accepted, queued, sending, or sent messages still non-terminal after 24 hours;
- zero pending `message_delivery_failure` approvals;
- a tracked, closed Twilio provider circuit;
- a clean Twilio reconciliation completed within the previous 24 hours, with no findings or provider errors.

Every check is fail-closed. Missing circuit history, missing reconciliation, stale reconciliation, future-dated evidence, partial provider results, unresolved incidents, or insufficient sample volume produces `voiceBuildAllowed: false`. A passing evaluation expires after 24 hours and must be regenerated from current operational evidence before voice engineering can proceed. Results contain aggregate counts and bounded operational states only—never destinations, client identifiers, message bodies, provider responses, or credentials. The immutable evaluation and its chained operator audit commit in one transaction after the repository revalidates the management actor, scope, fixed policy thresholds, exact window, expiry, counts, check set, and pass/fail consistency. An evaluation or audit collision leaves no voice prerequisite evidence visible.

Migration `055_voice_readiness_declarations.sql` adds the separate compliance boundary required before a voice runtime can be implemented or activated. An owner submits `POST /v1/operations/voice-readiness/attest` with a reviewed jurisdiction code, versioned AI-participation disclosure, versioned retention policy, disabled recording, a tested tenant-specific human transfer number, and all four required control acknowledgements. Voicemail is intentionally unavailable while recording is disabled. The repository locks and revalidates the latest location-scoped passing SMS evaluation in the same transaction that stores the immutable 90-day declaration and chained audit. The transfer number is never copied into audit or event evidence. A manager may inspect `GET /v1/operations/voice-readiness`, which separately reports `reliabilityCurrent`, `declarationCurrent`, and `voiceRuntimeAllowed`. The dashboard Activation screen exposes this sequence directly: management can evaluate current SMS evidence, owners can record the separate declaration, and the protected status response returns only a masked transfer destination; service-only runtime access retains the private value required to execute a transfer.

`voiceRuntimeAllowed` is an engineering and launch prerequisite. On this endpoint, `voiceEnabled` refers only to the deterministic signed Twilio handoff runtime. Conversational Realtime activation has its own release status described below. A fresh passing SMS evaluation is still required every 24 hours, while a current 90-day owner declaration can be reused with later passing evaluations. Any failed or expired evaluation, expired declaration, scope mismatch, stale evaluation race, or audit collision fails closed.

Configure the Twilio incoming-call webhook to `POST /webhooks/twilio/voice/inbound` for the deterministic handoff path. The ingester verifies Twilio's signature and resolves the location from the called number before reading readiness. Blocked calls receive a generic unavailable response. Allowed calls hear the salon name, automation and no-recording disclosures, then transfer immediately to the attested human destination. This fallback path performs no model inference, records no audio, originates no calls, and stores neither caller nor transfer numbers in event evidence.

The separately opt-in conversational path uses OpenAI Realtime over SIP. Point the telephony provider's TLS SIP trunk to the OpenAI project SIP URI and configure the OpenAI project webhook to send signed events to `POST /webhooks/openai/realtime`. Set `OPENAI_REALTIME_SIP_ENABLED=true`, `OPENAI_API_KEY`, and `OPENAI_WEBHOOK_SECRET`; pin the reviewed `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1`). The signed raw-body webhook resolves the called E.164 number from `OPENAI_SIP_DESTINATION_HEADER` (default `To`) against the existing active Twilio channel route, rechecks the complete production release boundary, rejects blocked calls, and deduplicates provider events before accepting a session. Credentials and feature flags alone never authorize a production conversation.

The Realtime session is server-controlled over an authenticated sideband WebSocket. Its required first response discloses that it is an AI assistant and that the call is not recorded. This release exposes only `transfer_to_human` and `wait_for_user`: it cannot book, cancel, reschedule, quote availability or prices, take payments, issue refunds, or collect sensitive information. Human requests and out-of-scope or uncertain cases use SIP REFER to the attested private transfer number. Sideband errors also attempt that transfer. Audio and transcripts are not persisted; event evidence contains the provider call identifier and bounded readiness state, never caller or transfer numbers. Keep the deterministic Twilio handoff configured as the operational fallback until a controlled SIP sandbox call verifies disclosure, transfer, silence, interruption, and failure behavior.

### Controlled Realtime SIP sandbox evidence

The conversational runtime records only timestamped control signals in `realtime_voice_calls`: sideband connection, disclosure request, silence-tool observation, transfer request/completion, and sideband failure. It does not store audio, transcripts, caller numbers, or the private transfer destination. In a non-production environment with a dedicated test number and current readiness evidence, have an authorized tester place one controlled call, remain silent long enough to exercise `wait_for_user`, then request a human and confirm the transfer. The tester must separately confirm that the disclosure was audible and the transfer quality was acceptable; server evidence proves that a response and provider transfer were requested, not what a person heard.

Set `VOICE_SANDBOX_ALLOW_EVALUATION=true`, the tenant/location and provider `call_id`, the reviewed `OPENAI_REALTIME_MODEL`, a 5–240 minute evidence window, and a new `VOICE_SANDBOX_EVIDENCE_OUTPUT` path. `npm run voice:sandbox:preflight` validates configuration without reading the database or calling a provider. `npm run voice:sandbox:evaluate` reads the tenant-scoped control ledger and current readiness declarations, fails closed on missing/stale signals, model drift, sideband failure, recording configuration, or incomplete transfer, and writes a redacted SHA-256-referenced report with create-only semantics. It never places a call or activates voice.

When `OPENAI_REALTIME_SIP_ENABLED=true`, the full protected `npm run release:validate` gate requires this fresh controlled-call evaluation in addition to the existing model, provider, security, and restore gates. Local validation remains provider-free. Keep the feature disabled if the human-observed checklist or machine evidence fails.

### Explicit Realtime production activation

Migration `058_realtime_voice_activation.sql` adds immutable, tenant-scoped sandbox evidence and activation records. Production accepts a conversational call only when all of the following are current at call time: the pinned model, a passing SMS reliability evaluation, the latest owner voice-readiness declaration, a passed sandbox report attested within 24 hours, and an explicit owner activation binding the latest evidence and declaration. A new evidence attestation, a new readiness declaration, model drift, or evidence expiry invalidates the old activation. A routine daily SMS reliability refresh does not require reactivation, but it must still be passing and current.

A clean environment can produce its first report through the controlled non-production bootstrap. On an isolated staging deployment, set `VOICE_SANDBOX_ALLOW_CONTROLLED_CALL=true`, `VOICE_SANDBOX_DESTINATION` to a dedicated test number, and the exact `VOICE_SANDBOX_TENANT_ID` and `VOICE_SANDBOX_LOCATION_ID`. The bootstrap still requires current SMS and owner-readiness evidence. It is ignored when `NODE_ENV=production`. Place the single controlled call, capture its provider `call_id`, then immediately set `VOICE_SANDBOX_ALLOW_CONTROLLED_CALL=false` and restart the webhook service before evaluating the report.

After the machine report passes, the tester must review the actual call and explicitly attest all four human observations. The payload command validates the report, maps the complete machine checklist, and binds the exact report bytes with SHA-256:

```sh
VOICE_RELEASE_AI_DISCLOSURE_AUDIBLE=true \
VOICE_RELEASE_TRANSFER_COMPLETED=true \
VOICE_RELEASE_SILENCE_ACCEPTABLE=true \
VOICE_RELEASE_INTERRUPTION_ACCEPTABLE=true \
npm run voice:release:payload -- release-evidence/voice-sandbox-unique.json > /tmp/voice-release-payload.json
```

An authenticated owner imports that redacted payload and then performs the separate activation. A manager may inspect status but cannot attest evidence or activate:

```sh
curl -sS -X POST "$API_BASE_URL/v1/operations/voice-release/evidence" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/voice-release-payload.json

curl -sS -X POST "$API_BASE_URL/v1/operations/voice-release/activate" \
  -H "Authorization: Bearer $OWNER_TOKEN"

curl -sS "$API_BASE_URL/v1/operations/voice-release" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```

Do not activate if the status response does not show `evidenceCurrent`, `activationCurrent`, `realtimeRuntimeAllowed`, and `realtimeVoiceEnabled` as `true`. The write-once report remains outside the database; persistence contains its digest, a scoped call reference hash, bounded booleans, model, timestamps, and chained audit evidence—never phone numbers, audio, or transcripts. The deterministic Twilio handoff remains independently available as the fallback.

## Release-candidate validation

`npm run release:validate:local` runs the complete deterministic suite and the API/frontend production build. A local pass is intentionally reported as `local_passed` with `releaseEligible: false`; it is useful during development but is not launch evidence.

`npm run release:validate` is the fail-closed launch gate. In addition to the local checks, it runs the pinned-model golden evaluation, provider sandbox smoke test, conditional Realtime SIP evidence evaluation, and PostgreSQL restoration drill. The provider test:

1. refuses `NODE_ENV=production`, a non-sandbox Square environment, or a Stripe live key;
2. requires `SANDBOX_ALLOW_PROVIDER_MUTATIONS=true` before making external writes;
3. creates, retrieves, and cancels one Square sandbox booking, with cleanup attempted if a later assertion fails;
4. sends one clearly labelled message to `SANDBOX_TWILIO_TO`, using the configured status callback;
5. validates Stripe test-mode API access without creating a charge or subscription;
6. waits 5–60 seconds for the Square cancellation and Twilio delivery callback to appear in the correct tenant/location event ledger.

Run `npm run sandbox:preflight` before enabling a release window. It reports missing or unsafe variable names without printing credential values. Populate the `SANDBOX_*` settings shown in `.env.example` with a controlled test customer, handset, bookable service/staff pair, provider location, catalog version, and future available time. A plain E.164 `SANDBOX_TWILIO_TO` selects `TWILIO_FROM_NUMBER`; a `whatsapp:+E164` destination selects `TWILIO_WHATSAPP_FROM_NUMBER`. The callback URLs must be publicly reachable HTTPS endpoints. The message is a real provider request and may incur a sandbox/test-account charge.

`npm run db:restore:drill` requires PostgreSQL client binaries `pg_dump` and `pg_restore`, `DATABASE_URL`, and `BACKUP_DRILL_ADMIN_URL`. It creates a uniquely named disposable database on the same server, restores a fresh logical backup, compares critical table counts, force-drops only that generated database, and deletes its private temporary dump. Infrastructure still owns encryption, retention, point-in-time recovery, and cross-region backup policy.

Set `RELEASE_EVIDENCE_OUTPUT=release-evidence/<unique-name>.json` to retain the command-level gate report. Existing evidence files are never overwritten, and the ignored `release-evidence/` directory prevents runtime evidence from entering source control accidentally. Production activation remains blocked unless the full report says `releaseEligible: true`.

## Three-service container runtime

The root `Dockerfile` produces one non-root, production-dependency-only image for the separately deployable API, webhook ingester, and workflow worker. Deploy the same immutable image digest with the commands `node dist-server/index.js`, `node dist-server/webhook-index.js`, and `node dist-server/workflow-index.js`; service-specific rebuilds are not permitted. The full command, port, routing, migration, shutdown, and secret-boundary contract is documented in `deploy/README.md`.

The Node base is pinned by exact version and official multi-architecture manifest digest. The read-only GitHub Actions pull-request gate runs the deterministic release validator and builds that image without receiving secrets or deployment permissions. GitHub-authored actions are pinned by full commit ID, and weekly Dependabot proposals for npm and workflow dependencies must pass the same gate.

Every service exposes process-only `/livez` and dependency-aware `/readyz` probes. API and webhook readiness verify PostgreSQL without returning an error or connection detail. Worker readiness additionally fails during shutdown or when one tick exceeds `WORKER_STALL_MS`, while its private health listener uses `WORKER_HEALTH_HOST` and `WORKER_HEALTH_PORT`. `SIGTERM` removes services from readiness, drains HTTP work or stops worker polling, and closes the shared database pool. Production task definitions must bind service listeners to `0.0.0.0`; local defaults remain on loopback.

The manager operations endpoint adds tenant-scoped backpressure checks without exposing queue content. It warns on configurable unpublished-event count or age, due-workflow count or lag, abandoned worker leases, and any mismatch between the active prompt and fresh pinned-model evaluation. Thresholds are bounded through the `OPERATIONS_*` environment settings documented in `.env.example`; checks never mutate provider or queue state. See `deploy/operational-health.md`.

## Golden agent evaluation gate

Migration `031_agent_evaluation_runs.sql` adds tenant/location-scoped release evidence for synthetic agent evaluations. Records contain the dataset and prompt versions, pinned model, aggregate metrics, and failing case identifiers only. Customer messages, model traces, prompts, credentials, and full generated drafts are not persisted.

Dataset `2026-07-19.1` contains exactly 150 synthetic conversations across 25 blueprint risk families: ambiguous services, timezone and daylight-saving language, changed or unavailable staff, duplicate and stale context, changed requirements, ambiguous confirmations, multilingual opt-outs, pricing disputes, refund demands, medical safety, abuse, prompt injection, internal-data requests, closure and no-slot scenarios, third-party and family bookings, minors, lost network responses, already-booked recovery recipients, and routine booking mutations and questions.

`npm run eval:golden` exercises the deterministic safety/router layer without an API key. Launch thresholds are at least 95% route accuracy, 100% safety recall, 100% confirmation-decision accuracy, and zero grounding violations. Grounding checks reject drafts that expose restricted internals or invent price, availability, or completed appointment actions. Opt-out, medical, financial/legal, explicit human, underage-policy, injection, and internal-data handling is enforced before a model request.

`npm run eval:golden:model` evaluates the pinned `MODEL_CONCIERGE` against the same set using redacted synthetic content, no response storage, a hashed safety identifier, at most 500 output tokens per case, and at most three concurrent calls. Six confirmation cases remain deterministic, so a full run makes up to 144 model requests. It refuses to start unless `EVAL_ALLOW_MODEL_CALLS=true` and `OPENAI_API_KEY` is configured. Set `EVAL_EVIDENCE_OUTPUT=release-evidence/<unique-name>.json` for write-once file evidence and `EVAL_PERSIST_TO_DATABASE=true` to store the redacted summary after migration 031.

The local release validator includes the deterministic golden gate. The full release validator additionally requires the pinned-model golden gate to pass before `releaseEligible` can become true. A model or prompt change therefore requires a fresh full evaluation rather than inheriting evidence from an older release.

The full validator also runs `bot:preflight` and `security:preflight`. The latter requires dependency and privileged-access reviews completed within 93 days; setting `SECURITY_ENTERPRISE_RELEASE=true` additionally requires independent penetration-test evidence completed within 366 days. Evidence values are opaque references held by the protected release environment. The validator emits their ages only and never prints report locations or contents.

## Tamper-evident audit ledger

Migration `024_audit_integrity_chain.sql` makes `audit_log` database-append-only and adds a separate chain head per tenant/location. Each new record receives a monotonic sequence, the previous record hash, and a SHA-256 hash over canonicalized identity, action, reason, redacted input, result, timestamp, sequence, and prior hash. PostgreSQL serializes concurrent appends with a tenant-scoped advisory lock and commits the record and chain head together.

Existing pre-migration audit rows remain readable. The first new append computes and stores a deterministic legacy anchor over those rows; subsequent verification recomputes that anchor, so later changes to older history break the chain. Empty ledgers are valid, legacy-only ledgers warn until anchored, and altered content, missing sequence numbers, or broken previous-hash links degrade tenant health.

Managers can call `GET /v1/audit-log/verify` for a secret-free integrity report containing counts, status, head hash, and the first failing record identifier. `GET /v1/audit-log` continues to return tenant-scoped records with their chain evidence. This detects accidental or unauthorized application/database mutation; production backups and restricted database administration remain necessary because a database owner can change schema-level protections.

## Client data access exports

Migration `025_privacy_data_exports.sql` adds metadata-only receipts for client access exports. An owner or manager can call `POST /v1/privacy/clients/:clientId/export` with a documented `reason` to receive one canonical JSON attachment containing the subject's profile, consent evidence, appointments and holds, waitlist entries, conversation messages, review and recovery outreach, message-delivery records, exact-client provider events, and audit records whose entity is that client.

The snapshot is constrained by the authenticated tenant and location. PostgreSQL builds it in a read-only, repeatable-read transaction so every section comes from one consistent database view. The export excludes integration credentials, billing, salon settings, catalog and staff data, model prompts and traces, approvals, aggregate reports, and records belonging to other clients. A missing subject fails closed instead of producing an ambiguous empty package.

The response is canonicalized before delivery, marked `Cache-Control: no-store`, and returned as an attachment. `X-Content-SHA256` is the SHA-256 digest of the exact response bytes. The server persists only the export ID, scope, subject ID, requester, reason, digest, generation time, and per-section counts; it never persists another copy of the exported package. The receipt and its PII-safe disclosure audit commit in one transaction before the package is returned; an audit collision leaves no receipt and no successful response. Audit evidence contains only the export ID, digest, aggregate counts, and timestamp—not the requester reason or exported content. `GET /v1/privacy/data-exports` is manager-only and lists those tenant-scoped receipts without exported content.

Data erasure is intentionally separate from access export. Appointment, financial-attribution, consent, and immutable audit retention must be governed by a configured jurisdiction-specific retention and legal-hold policy before destructive workflows are enabled.

## Retention governance and legal holds

Migration `026_privacy_retention_governance.sql` adds one owner-attested retention policy per tenant/location and a client-scoped legal-hold ledger. Policy configuration is owner-only at both the API and repository boundaries and requires an explicit counsel-approval attestation, jurisdiction, version, legal basis, effective date, and bounded periods for client profiles, conversations, bookings, outreach records, provider events, and export receipts. A policy update and its chained audit commit together; an audit collision preserves the prior policy. The operational record retains the legal basis, while immutable audit evidence replaces that free text with a redacted marker. Managers can read the policy, but cannot create or change it. Tenant health reports a warning until an effective policy exists.

Owners can create a legal hold only for a client with data in the current tenant/location. Holds record their creator, reason, creation time, and optional future expiry. They override every retention category until explicitly released or their expiry passes. Creation and release are owner-only at both the API and repository boundaries. Each state change and its redacted chained audit commit in one transaction; an audit collision cannot create a hold or release one that protects deletion. Cross-tenant and already-released holds remain non-mutating.

Governance routes:

- `GET /v1/privacy/retention-policy` and owner-only `PUT /v1/privacy/retention-policy`;
- `GET /v1/privacy/legal-holds`, owner-only `POST /v1/privacy/legal-holds`, and owner-only `POST /v1/privacy/legal-holds/:holdId/release`;
- `GET /v1/privacy/clients/:clientId/retention-preview` for a manager-visible, no-store eligibility calculation.

The preview fails closed. Cleanup is allowed only when a policy exists, is effective, has deletion enabled, and no active legal hold applies. It reports category counts without mutating data. Client profiles use the most recent operational client activity; conversations are treated as whole threads; active holds and waitlist entries are never eligible. Consent evidence and the append-only audit ledger are always retained.

## Approval-controlled client erasure

Migration `027_privacy_erasure_execution.sql` adds expiring erasure requests and metadata-only completion receipts. A manager or owner prepares a request through `POST /v1/privacy/erasure-requests`; the server freezes only eligible record identifiers and counts, binds them to the exact policy version and update timestamp, hashes the canonical plan, and expires it after 24 hours. Repeating an unchanged request returns the existing pending plan without duplicate evidence. For a changed or expired plan, superseding the old request, creating the replacement, and appending its redacted chained audit record share one transaction; an audit collision leaves the old plan pending and no replacement behind. `GET /v1/privacy/erasure-requests` lists the tenant/location ledger.

Execution is owner-only through `POST /v1/privacy/erasure-requests/:requestId/execute` and requires the exact confirmation string `DELETE ELIGIBLE CLIENT DATA` plus an approval note. Immediately before mutation, the service rebuilds the plan; any new eligible record produces `ERASURE_PLAN_STALE`. PostgreSQL then obtains a client-scoped advisory lock and re-reads the pending request, effective policy, policy version, policy update time, request expiry, deletion flag, and active legal holds inside the deletion transaction. A changed gate aborts without partial deletion.

Eligible review, recovery, delivery, whole-conversation, event/outbox, expired export-receipt, and client-profile records are deleted in referentially safe order. Bookings and holds are deleted only when no revenue attribution or live conversation action still references them; waitlist entries are deleted only when they have no offer history. Protected records are reported as skipped rather than forcing a financial or provider-history cascade. Consent evidence, revenue attribution, legal-hold history, erasure requests/receipts, and the append-only audit chain remain. The completed request, exact deleted/skipped counts, receipt, redacted owner-approval audit, and completion audit commit in one transaction; an audit or receipt collision rolls back the deletion entirely.

## PII-safe audit and agent traces

All new audit writes pass through one recursive redaction boundary before the record is hashed and appended. Customer message bodies, names, phone and destination fields, email recipients, provider customer IDs, evidence URLs, confirmation and access tokens, credentials, checkout session identifiers, administrator notes, and binary secret material are replaced with explicit redaction markers. Free text additionally removes email addresses, international phone numbers, and bearer credentials without corrupting timestamps, UUIDs, or integrity digests. Operational records such as client profiles and conversation messages retain the data required to serve the customer and remain subject to the access-export and future retention controls.

Agent-run records no longer persist model-written draft text or free-form classification explanations. They store only the bounded intent, confidence, urgency, human-review flag, and a deterministic classification label; the customer-facing draft remains in the tenant-scoped conversation record. Idempotent retries reconstruct their response from that operational message rather than from trace content. Booking tool traces keep validated arguments and a bounded outcome summary—counts, selected internal IDs, expiry, or error code—instead of complete tool results. OpenAI requests continue to use `store:false`, hashed tenant/conversation safety identifiers, and the same centralized email and international-phone redactor.

Redaction applies before new immutable audit records are sealed. Pre-existing audit history is not rewritten because doing so would invalidate the append-only integrity chain; deployments upgrading an existing database should assess legacy records under their retention and incident-response procedures.

With `DATABASE_URL` configured, apply the schema with `npm run db:migrate`. The runner discovers every numbered SQL migration in lexical order, so new production migrations are not silently omitted by a stale hard-coded list.

Run the API with `npm run dev:api`, the webhook ingester with `npm run dev:webhooks`, then check `GET http://127.0.0.1:4100/health` and `GET http://127.0.0.1:4200/health`.

## Workflow worker

Run the separately deployable worker with `npm run dev:worker` or `npm run start:worker`. A shared `DATABASE_URL` is required for the API, webhook ingester, and worker to exchange production events; process-local `MemoryStore` instances are only suitable for isolated tests.

The worker transactionally converts outbox events into durable, business-key-deduplicated jobs:

- bookings create immediate confirmations and 24-hour reminders;
- reschedules replace the reminder key with the new start time;
- cancellations create waitlist-matching work;
- no-shows create a delayed recovery workflow;
- completed visits create a 24-hour neutral review request plus a configured or default 45-day rebooking workflow.
- inbound conversation events create immediate, message-keyed draft-routing work.
- eligible sent booking replies create a twenty-minute abandoned-enquiry check.
- signed missed inbound-call events create a two-minute SMS recovery check.

Workers claim jobs with PostgreSQL `SKIP LOCKED`, recover leases abandoned for five minutes, and retry transient failures with bounded exponential backoff. A terminal failure atomically marks the claimed job failed, appends an immutable PII-free dead-letter record, opens the linked manager approval, and writes its `approval.requested` domain/outbox event with the dead-letter ID; a worker crash cannot strand any part of that evidence chain. Missing factual contact data is a terminal error rather than an invented message target. Legacy confirmation and reminder events default to SMS. Explicit SMS or WhatsApp jobs must match the active Twilio location route and pass exact transactional-consent validation; the delivery ledger, `message.sent` event, and chained audit preserve that channel, and an idempotency key cannot be reused across delivery scopes. Reschedule events include the authoritative client, booking reference, and original notification channel so their replacement reminders remain executable. Square `booking.created`, cancelled `booking.updated`, and no-show `booking.updated` webhooks are normalized into internal appointment events after signature verification; API and webhook events share a provider-booking deduplication key.

## Waitlist recovery and attribution

- `POST /v1/waitlist` joins a client after exact transactional SMS or WhatsApp consent is verified. SMS remains the backward-compatible default; an explicit channel must match the active location route.
- `GET /v1/waitlist` returns only the authenticated tenant/location entries.
- `POST /v1/waitlist/offers/:offerId/respond` accepts or declines a live offer.
- `GET /v1/recovery-cases` exposes the auditable open/resolved recovery ledger.
- `GET /v1/revenue-attribution` returns verified recovered-booking values.

Cancellation recovery ranks eligible entries by fewest previous offers, oldest offer time, and join time. It creates one exclusive ten-minute offer per cancelled slot. Migration `053_waitlist_channel.sql` binds each entry and offer to its consent-authorized SMS or WhatsApp channel and safely backfills legacy records as SMS. Recovery-case opening uses the same atomic event, outbox, and chained-audit ledger as every other recovery workflow. After the provider accepts the offer message, the repository locks the offer and entry, then atomically records the provider receipt, emits `waitlist.match_found` with the immutable channel, schedules the exact expiry job, and appends a PII-free audit. A collision leaves the offer unmarked and unscheduled for a provider-idempotent retry; PostgreSQL returns that same active offer to the originating job so repair is possible after a restart. Acceptance atomically marks the offer and entry and records response event and audit evidence, but the original offer deadline remains authoritative. A decline or accepted-but-unclaimed expiry atomically restores entry eligibility, records the response or expiry evidence, and schedules exactly one continuation job before advancing to a client who has not already received that slot. When no unoffered eligible entry remains, the durable recovery case closes with `waitlist_exhausted`, a `recovery.resolved` event, and chained audit evidence instead of remaining open indefinitely. Accepting an offer does not itself book anything: the customer must still create a matching provider hold and explicitly confirm. `POST /v1/bookings` accepts `waitlistOfferId`, verifies the same tenant, client, service, staff, and start time, then atomically claims both the hold and accepted offer before calling the provider. An expiry worker that encounters the `booking` claim reschedules instead of racing the confirmation; a provider failure releases the hold and restores the offer to `accepted`. The offer and recovery case become resolved only after the provider booking and verified attribution succeed. Revenue uses the authoritative booking price and is unique per booking.

## Recovery contact policy and reporting

No-show, post-visit, and lapsed-client outreach is classified as marketing. Workflow events identify only the client; the worker resolves the destination and timezone from the tenant-scoped client profile and resolves the salon identity from location settings. Payload-supplied contact details cannot override those authoritative records. Missing data is terminal rather than inferred. SMS remains the default; an explicit `channel: "whatsapp"` is accepted only when the location's active Twilio route is WhatsApp. Messages require exact marketing consent for the selected channel, identify the sender, and include `Reply STOP to unsubscribe`. Unsupported or route-mismatched channels fail before opening a recovery case.

Recovery outreach is allowed only from 09:00 through 19:59 in the client's timezone. Outside that window, the durable job is rescheduled to the next allowed local time. Before reserving a send, the worker checks that the client has no future booking and enforces:

- at least seven days between recovery messages;
- no more than two sent recovery messages in any rolling 30-day period;
- one reservation per workflow job under a tenant/client PostgreSQL advisory lock.

Frequency limits are client-wide across SMS and WhatsApp, so switching channels cannot bypass contact policy.

After the provider accepts a recovery message, the repository locks the reserved contact and atomically marks it sent, stores any validated controlled-experiment exposure, emits `recovery.contact_sent` through the outbox, and appends a PII-free chained audit. The selected SMS or WhatsApp channel is fixed at reservation time and is carried by the durable contact, privacy export, event, and audit evidence; migration `051_recovery_contact_channel.sql` safely classifies legacy contacts as SMS. Experiment identity, variant, workflow, provider receipt, channel, and contact state therefore cannot diverge. A collision leaves the contact reserved and exposes no sent touch for revenue attribution; a completed workflow retry returns without sending again or moving the original touch timestamp.

Cases blocked by an existing booking or frequency policy are closed with the deterministic reason. `client.lapsed` events create `lapsed_reactivation` jobs, while completed and no-show appointments retain their delayed workflows.

Recovery-case opening is transactionally idempotent by tenant, location, recovery type, and correlation. The open case, immutable `recovery.opened` domain/outbox event, and PII-free chained audit commit together under a PostgreSQL advisory lock. A retry returns the original case without publishing another event or audit; an event or audit collision leaves no case visible. Deterministic closure for an existing booking or frequency cap uses the same lock and atomically commits the closed case, one `recovery.resolved` event/outbox record, and one chained audit; retries preserve the terminal case without duplicating evidence, while an evidence collision keeps it open. The audits record only workflow identity, recovery type, bounded potential value, currency, terminal reason, and state—never the client identifier or workflow payload.

Migration `020_recovery_revenue_attribution.sql` extends the verified ledger beyond explicit waitlist offers. After an explicitly confirmed booking is committed, deterministic code checks sent recovery evidence for that client and selects the most recent eligible touch. Abandoned-enquiry and missed-call touches expire after 24 hours, no-show recovery after seven days, and post-visit or lapsed-client outreach after 14 days. A touch outside its window cannot receive credit.

Every attribution stores the source record, workflow job, touch timestamp, booking identifier, authoritative booking value and currency, and evidence method. Only one source can receive credit for a booking. Explicit accepted waitlist offers remain direct evidence; other sources require a persisted sent recovery before the booking timestamp. For waitlist fills, the repository locks and revalidates the authoritative booking, its `booking`-claimed offer, and matched entry, then transitions both waitlist records and commits the attribution, `revenue.recovered` event/outbox record, and PII-free chained audit in one transaction. For abandoned-enquiry, missed-call, no-show, post-visit, and lapsed recovery, it locks the booking and attribution key and revalidates the exact persisted sent touch before committing the same evidence set. An audit, event, source, booking-value, or currency mismatch leaves no recovered revenue visible and preserves the booking claim for a safe retry. Retried booking requests return the original attribution instead of creating another record. When the winning touch belongs to a recovery case, that case is resolved with the verified booking.

Recovery-case resolution is independently atomic and repairable after attribution. The repository locks both the case and authoritative booking, validates their tenant/location scope, then commits the resolved state, one `recovery.resolved` domain/outbox event, and a PII-free chained audit. Booking retries return the existing terminal case without duplicating evidence; an audit or event collision leaves the case open so the same persisted attribution can safely repair it on retry. The audit stores bounded recovery type, workflow and attribution metadata plus authoritative value and currency, never the client identifier.

`GET /v1/reports/weekly?from=<RFC3339>&to=<RFC3339>` accepts a maximum eight-day window and reports recovered bookings, case outcomes, and verified revenue separated by currency and recovery source. It includes the supporting attribution records and explicitly excludes estimated and unattributed revenue.

## Controlled recovery experiments

Migration `035_controlled_experiments.sql` adds manager-controlled copy experiments for no-show, post-visit, and lapsed-client recovery. An experiment can change only the text body. It cannot select an audience, alter the SMS marketing purpose, change consent requirements, bypass quiet hours or frequency caps, claim availability, set prices or offers, or perform a booking action.

Every variant must begin with the authoritative `{{sender}}` variable, end with the exact `Reply STOP to unsubscribe.` instruction, use no other variables, and pass deterministic checks against urgency, scarcity, discount, free-service, refund, and guarantee claims. Allocations must total exactly 100. Variant copy and allocation are immutable after draft creation; the only transitions are manual activation, pause, and completion. A tenant/location can have only one active experiment per recovery workflow, enforced under a shared PostgreSQL lock and a partial unique index.

- `GET /v1/experiments` lists tenant/location experiments for owners and managers.
- `POST /v1/experiments` creates an immutable draft and its chained creation audit in one transaction; an audit collision leaves no draft behind.
- `POST /v1/experiments/:experimentId/activate`, `/pause`, and `/complete` perform manual transitions. The experiment advisory lock, row-locked state update, active-workflow exclusion check, and chained audit record share one transaction; an audit collision leaves the prior state unchanged. Activation also requires the existing billing and onboarding automation gates.
- `GET /v1/experiments/:experimentId/results` returns exposure, verified recovered bookings, conversion rate, and authoritative recovered revenue by currency for each variant.

Assignment is a stable SHA-256 bucket over tenant, location, experiment, and client identifiers, so retries and later contacts do not move a client between variants. An exposure is written only after Twilio accepts the consent-checked message and is idempotent by workflow job. Results join exposures to the existing verified booking-attribution ledger by workflow job; clicks, replies, estimates, and model judgments never count as recovered revenue. The API reports whether each variant has at least 50 exposures but never declares or rolls out a winner automatically.

## Operations control plane

Authoritative operating data is tenant/location scoped:

- `GET` and manager-only `PUT /v1/location-settings` manage the salon name, SMS sender identity, timezone, brand voice, report recipient, and optional public review URL. Settings updates use a location-scoped transaction and chained audit. When the communication policy changes, the same transaction invalidates an active onboarding activation; an audit collision preserves both the prior settings and active state. Audit evidence records only bounded policy metadata and configuration-presence flags, never report or escalation email addresses or free-form brand voice.
- `GET /v1/clients`, `GET /v1/clients/:clientId`, and operator-or-manager `PUT /v1/clients/:clientId` manage structured contact profiles. Profile mutation, version continuity, and chained audit evidence share one client-scoped transaction; an audit collision preserves the prior profile. Audit records retain the client record key and bounded scheduling metadata while replacing display names, destinations, and provider customer identifiers with explicit redaction markers before hashing.
- `GET /v1/approval-requests` and `POST /v1/approval-requests/:requestId/decision` are manager-only. Terminal workflow failures, report-delivery failures, and expired Square connections open deduplicated requests. Approving a failed workflow resets its attempt state and returns it to the durable queue; rejecting it leaves the failed job closed. The locked decision, optional replay reset, immutable `approval.decided` domain/outbox event, and chained redacted audit record commit in one transaction. An evidence collision or stale replay target leaves both the pending approval and failed job unchanged.
- `GET /v1/operations/workflow-dead-letters` is manager-only and returns immutable location-scoped terminal-failure evidence without workflow payloads or customer identifiers. Approved replays never delete prior evidence; a later terminal failure creates a new ledger entry and approval. Follow `deploy/workflow-dead-letters.md` before replaying uncertain provider work.
- `GET /v1/message-deliveries` is manager-only and returns the tenant/location outbound delivery ledger, including provider receipt state and redacted failure codes. Verified Twilio status callbacks lock the expected prior delivery, update the delivery ledger and linked conversation message, and append a chained audit record in one transaction; stale callbacks or audit failures roll both records back. Provider message identifiers are explicitly redacted before audit hashing.
- `GET /v1/review-requests` is manager-only and returns the tenant/location review eligibility, delivery, suppression, and negative-feedback linkage ledger. Review reservation (including the uniform 90-day suppression decision), ineligibility closure, and accepted-send completion each use chained transactional audit evidence. Send completion also inserts the immutable `review.requested` domain/outbox event in that transaction. Negative feedback locks and validates the referenced inbound message plus service-recovery approval, then commits the review linkage, `review.feedback_received` event/outbox record, and redacted audit together. A duplicate Twilio delivery repairs a prior linkage failure without creating a second approval or event. Evidence collisions leave the prior review state unchanged, and audit payloads contain only redacted appointment, client, message, provider-message, and review-link-presence metadata.
- `POST /v1/reports/weekly/schedule` atomically stores its recipient in location settings, creates exactly one durable weekly job for the requested first-run time, and appends a chained audit record. The repository locks and rejects stale settings snapshots or duplicate recurrence keys; any job or audit failure rolls the recipient update back. Audit evidence records only that a recipient is configured, never the address. `GET /v1/reports/weekly/snapshots` returns generated, delivered, or failed snapshots.
- `GET /v1/operations/health` returns a secret-free manager readiness view across settings, Square, catalog sync, client profiles, messaging, provider circuits, uncertain booking outcomes, reporting, workflows, and pending approvals.
- `GET /v1/operations/provider-circuits` returns tenant-scoped provider state; owner-only `POST /v1/operations/provider-circuits/:provider/reset` closes one circuit after a documented operational check.
- `POST /v1/operations/reconciliation-runs` performs a bounded, read-only Square/Twilio comparison; `GET /v1/operations/reconciliation-runs` returns tenant-scoped history and findings.

The report worker sends a plain-text, verified-booking-only summary through Postmark when `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM_EMAIL` are configured. A successful run schedules its next occurrence exactly seven days later. Missing or failed delivery pauses the recurrence through the normal terminal-failure approval path rather than silently dropping a report.

Migration `009_workflow_operations.sql` aligns workflow causation identifiers with both provider-event and audited manual sources, and removes the older event/type uniqueness constraint in favor of the explicit business `dedupe_key`.

## Owner multi-location portfolio

Migration `036_tenant_portfolio_indexes.sql` adds tenant-period indexes for bounded cross-location reporting. `GET /v1/reports/portfolio?from=<RFC3339>&to=<RFC3339>` accepts at most 31 days and is restricted to the authenticated `owner` role. Managers and operators remain confined to the location in their signed session claim. The route never accepts a tenant identifier or a list of locations from the caller.

PostgreSQL builds the source data inside one repeatable-read, read-only transaction and filters every query by the verified tenant claim. The report discovers that tenant's locations from authoritative operating records and returns, per location and in tenant totals:

- verified recovered bookings and revenue separated by currency;
- recovery cases opened, resolved, closed, and still open in the requested period;
- outbound delivery attempts, delivered and failed outcomes, and delivery rate;
- current SMS/WhatsApp marketing-consent records, opt-outs, and the current opt-out ratio;
- current pending, running, failed, and paused workflows plus pending approvals;
- active, draft, and paused controlled experiments;
- activation, billing, and provider-circuit state.

The response contains no client identifiers, destinations, message bodies, consent evidence, booking identifiers, workflow payloads, or approval reasons. Revenue remains verified-booking-only and never converts or combines currencies. The consent ratio is explicitly labelled `current_record_snapshot_not_period_flow` because the consent table represents current authority, not a historical event funnel. Every portfolio view creates a redacted audit record with only the period, location count, aggregate recovered-booking count, currencies, and pending-approval count.

## Agency and reseller portfolio access

Migration `037_agency_portfolio_grants.sql` adds optional agency accounts, short-lived invitations, and bilateral grants. This foundation does not add an agency authentication role and does not merge tenant identities. An agency operates from its own tenant, and only that tenant's authenticated owner can administer its agency account. The initial and only grant scope is `portfolio_read`.

The consent flow is explicit:

1. The agency owner configures `PUT /v1/agency/account`.
2. `POST /v1/agency/invitations` creates an invitation addressed to one exact client tenant for 1–30 days. The raw 256-bit acceptance token is returned once; only its SHA-256 digest is stored, and neither the token nor digest enters audit records.
3. An authenticated owner of the addressed client tenant uses `POST /v1/agency/invitations/preview` to see the agency display name, support email, exact scope, and expiry without granting access.
4. The same client owner calls `POST /v1/agency/invitations/accept`. Acceptance is transactionally idempotent and creates at most one active grant for the agency/client pair.
5. The agency owner can list relationships through `GET /v1/agency/grants`; the client owner can independently discover every relationship affecting its tenant through `GET /v1/agency/client-grants`.
6. Either tenant's owner can immediately revoke a known grant through `POST /v1/agency/grants/:grantId/revoke` with a documented reason.

Agency account saves, invitation issuance, invitation acceptance (including idempotent replays), and grant revocation commit in the same repository transaction as their chained audit evidence. An audit collision or append failure therefore rolls back the access mutation. Raw acceptance tokens and stored token digests never enter the audit ledger, and revocation reasons are redacted there.

`GET /v1/agency/clients/:clientTenantId/portfolio?from=...&to=...` returns the same aggregate, identity-free portfolio report as the direct owner endpoint. The repository verifies the owner role, exact agency tenant, client tenant, active status, and `portfolio_read` scope inside the same repeatable-read transaction used to query client data. Revocation therefore blocks the next read without relying on a cache or API-only check.

Agency grants never authorize customer profiles, conversations, messages, destinations, bookings, holds, consents, approval decisions, billing changes, integrations, experiments, settings, exports, or workflow mutations. Self-grants, overlapping pending invitations, overlapping active grants, wrong-tenant acceptance, expired tokens, and non-owner access fail closed. Agency portfolio reads create redacted audit records in the agency tenant.

## Monthly owner governance review

Migration `039_monthly_owner_reviews.sql` adds immutable, SHA-256-digested monthly owner-review snapshots and bounded indexes for complaint and negative-feedback evidence. `POST /v1/reports/monthly-owner-review` accepts a `from`/`to` period of at most 31 days, is restricted to the authenticated tenant owner, and reads all tenant locations in one repeatable-read transaction. `GET /v1/reports/monthly-owner-review/snapshots?limit=12` returns up to 24 of that tenant's snapshots. Both routes use `Cache-Control: no-store`; managers, operators, service sessions, other tenants, and agency portfolio grants cannot access this dataset.

Each snapshot contains only governance-safe aggregates and draft experiment identifiers/metadata. It reports verified recovered revenue, the current approval backlog and age, bounded complaint and medical-safety signals, negative review feedback, current messaging opt-out records, provider circuit and reconciliation health, audit-chain integrity, breached tenant-rate-limit windows, active security-incident counts, and draft/active/paused experiment counts. Incident summaries and evidence references are excluded. Draft experiments are never activated by report generation.

Report generation first creates a fresh, versioned active-client cohort for the exact review period. Client churn is `available` only when that snapshot has at least one active client at the starting boundary; otherwise it remains explicitly `unavailable` instead of presenting an invented 0% rate. Model cost is `available` only when every captured provider response has valid provider-reported usage and an effective price version for the exact returned model. It becomes `partial` when usage or price evidence is incomplete and `unavailable` when the period contains no captured model responses. Reports contain no client identifiers, destinations, message bodies, approval reasons, conversation text, or experiment message templates. Every generated report is persisted with the canonical report's SHA-256 digest. The repository recomputes that digest and commits the immutable snapshot with its redacted chained audit in one transaction; an evidence collision leaves no report snapshot visible.

## Security incident response ledger

Migration `042_security_incident_ledger.sql` adds tenant/location-scoped current incident state and an append-only lifecycle event ledger. The database uses a composite incident/scope foreign key so an event cannot be attached to an incident belonging to a different tenant or location. It also rejects update or deletion of lifecycle evidence.

Owners and managers can declare an incident through `POST /v1/operations/security-incidents` and review scoped history through `GET /v1/operations/security-incidents?limit=50`. Declaration requires a structured category and severity, rejects customer contact information and secret-like text, and accepts only bounded non-secret evidence references. The incident, opening lifecycle entry, `security_incident` approval, both immutable domain/outbox events, and chained audit record commit in one transaction; any evidence collision rolls the declaration back completely. Managers can record `open -> contained`; owners are additionally required for `open -> false_positive` and `contained -> resolved` through `POST /v1/operations/security-incidents/:incidentId/status`. Every accepted transition similarly commits the locked current-state update, lifecycle entry, causally linked domain/outbox event, and chained audit record together. Approval decisions do not change incident state.

Every route is management-only and returns `Cache-Control: no-store`. Domain events, audit entries, tenant health, and monthly reports receive structured aggregate metadata rather than incident summaries. Active incidents make tenant health warn, and active SEV1 incidents create a critical monthly owner action. Follow [the production incident-response runbook](../deploy/incident-response.md) for containment, evidence preservation, recovery, and closure.

## Client cohort and churn evidence

Migration `041_client_cohort_snapshots.sql` adds immutable, SHA-256-digested aggregate cohort snapshots. `POST /v1/reports/client-cohorts` creates a snapshot for a `from`/`to` period of at most 31 days, while `GET /v1/reports/client-cohorts/snapshots?limit=12` returns up to 24 snapshots for the authenticated tenant. Both routes are owner-only and return `Cache-Control: no-store`; agency grants and location-scoped operational roles do not authorize access.

The fixed policy version `active-client-180d-v1` compares two 180-day activity windows: the window ending at the period start and the window ending at the period end. Only authoritative Square bookings whose current provider status is `COMPLETED` count as activity. Local-only, accepted, pending, canceled, declined, and no-show records do not count. The snapshot records aggregate completed-booking counts, starting and ending active-client counts, retained clients, churned clients, and newly active clients. Churn rate is `churnedClients / startActiveClients` only when `startActiveClients > 0`; an empty starting cohort is marked `insufficient` and stores `null`, never a misleading zero.

Snapshots and audit entries contain no client IDs, booking references, provider booking IDs, destinations, or message content. The repository recomputes the identity-free snapshot digest, verifies the owner, tenant, 180-day windows, aggregate relationships, and denominator status, then commits the snapshot and chained audit atomically. An evidence collision leaves no cohort snapshot visible. Monthly owner-review generation automatically creates a fresh exact-period cohort snapshot and incorporates it only when its denominator is sufficient.

## Model usage and cost evidence

Migration `040_model_usage_accounting.sql` adds immutable OpenAI response-usage records and append-only, owner-attested model-price versions. After each Responses API call, the conversation router and every booking-specialist tool step persist only the provider response ID, exact returned model, operation, agent-run ID, location scope, response time, and provider-reported input, cached-input, output, reasoning, and total token counts. Prompts, conversation text, tool arguments, model output, client identifiers, and destinations are not copied into the usage ledger. Malformed or absent usage is stored as `usageStatus: missing` rather than estimated.

Owners manage price evidence through `POST /v1/operations/model-prices` and `GET /v1/operations/model-prices`. Managers and operators are denied. Versions are append-only and effective times must move forward for each exact provider/model pair. The repository serializes each provider/model version sequence, revalidates the owner, tenant, bounded rates, effective time, currency, and source reference, then commits the new version and its redacted chained audit in one transaction. An audit or version collision leaves the prior price sequence unchanged. Each version records currency, input, cached-input, and output price in minor currency units per one million tokens, plus the owner's source label and optional source URL. Pricing is never fetched silently and no volatile provider price is hard-coded.

Monthly cost uses integer `micro-minor` currency units: uncached input tokens use the input rate, cached input tokens use the cached rate, and all output tokens use the output rate. Reasoning tokens are reported separately for visibility but are already included in output tokens and are not charged twice. `1,000,000` micro-minor units equal one minor currency unit. Historical monthly snapshots retain the exact price-version result and SHA-256 digest used when generated.

## Dashboard operations bridge

The React command centre now loads manager approval records and tenant health from the API whenever a development session is configured. Pending API approvals replace the prototype cards, resolved decisions populate the existing history view, and approve/reject actions call the audited decision endpoint. A safely replayed workflow is reported back to the operator before health is refreshed.

For local development, set `VITE_DEV_AUTH_TOKEN=dev:<tenant>:<location>:<user>:manager`; Vite proxies `/v1` and the unauthenticated `/public` intake boundary to the API on port 4100. This variable is read only in Vite development mode and must never contain a production bearer token. Without a development session, the visual prototype retains its sample workspace. Production authentication remains the responsibility of the verified Clerk/Auth0 session integration.

## Stripe Billing and trials

Migration `010_stripe_billing.sql` adds one tenant/location Stripe subscription record plus an immutable provider-event deduplication ledger. Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, server-owned success/cancel URLs, and an optional `BILLING_TRIAL_DAYS` from 0–730.

- `POST /v1/billing/checkout` is manager-only, requires an idempotency key, and creates a Stripe-hosted subscription Checkout Session. Tenant and location metadata are supplied exclusively by the authenticated server context.
- `GET /v1/billing` returns the authoritative subscription state and whether `active` or `trialing` access is available.
- `POST /webhooks/stripe` runs in the webhook ingester, verifies `Stripe-Signature` against the untouched raw body, and accepts subscription lifecycle events only when their signed subscription metadata resolves a tenant and location.

Webhook delivery is idempotent by Stripe event ID. Provider creation time prevents delayed events from rolling `active` or `trialing` state backward. The normalized record tracks `trialing`, `active`, `past_due`, `paused`, `canceled`, `incomplete`, `incomplete_expired`, and `unpaid`, while emitting a redacted immutable `billing.updated` event. Tenant health reports active/trial billing as ready and a recorded non-entitled subscription as blocked.

Migration `011_billing_policy_gate.sql` adds a durable `paused` workflow state. Set `BILLING_ENFORCEMENT_ENABLED=true` in non-production environments; production enables enforcement by default. Without `active` or `trialing` access, the worker pauses jobs without consuming their retry budget or opening repetitive approvals. A signed Stripe event restoring access automatically returns only billing-paused jobs to the queue.

The API gate blocks new outbound messages, holds, waitlist enrollments, and report schedules when enforcement is active. It deliberately does not block consent or opt-out writes, webhook ingestion, approval access, billing recovery, cancellation/rescheduling, or completion of a booking that was already explicitly confirmed. This keeps financial policy from trapping a customer in an unsafe or incomplete state.

## Multi-tenant provider routing

Migration `012_provider_routing.sql` removes production webhook routing from process-wide tenant environment variables:

- signed Square webhooks resolve `merchant_id` against the active tenant-scoped OAuth account;
- signed Twilio inbound webhooks resolve the exact destination (`To`) against an active `channel_routes` record;
- `GET /v1/channel-routes/twilio` and manager-only `PUT /v1/channel-routes/twilio` read or assign a location's SMS/WhatsApp destination. Assignment ownership, route version continuity, activation invalidation, and address-free chained audit evidence commit in one locked transaction. A changed destination or status drafts an active location until provider verification and onboarding are rerun; address or audit collisions preserve the prior route and activation;
- a destination address can belong to only one tenant/location, and unknown or disabled routes fail closed before consent or event writes;
- tenant health requires global Twilio credentials, the sender matching the route channel (`TWILIO_FROM_NUMBER` for SMS or `TWILIO_WHATSAPP_FROM_NUMBER` for WhatsApp), and an active location route. WhatsApp destinations are normalized to Twilio's `whatsapp:+E164` form; SMS and WhatsApp consent remain separate and a missing channel sender fails closed.

`SQUARE_WEBHOOK_TENANT_ID`, `SQUARE_WEBHOOK_LOCATION_ID`, `TWILIO_WEBHOOK_TENANT_ID`, and `TWILIO_WEBHOOK_LOCATION_ID` remain available only as non-production test/development fallbacks. They are ignored when `NODE_ENV=production`.

## Self-service onboarding activation

Migration `013_onboarding_activation.sql` adds immutable onboarding simulation runs and one activation record per tenant/location. The manager workflow is:

1. Complete location settings, Square OAuth and catalog sync, client import, Twilio routing, weekly report delivery, and Stripe trial/subscription setup.
2. Run the pinned-model golden evaluation with `EVAL_PERSIST_TO_DATABASE=true` for this tenant and location.
3. Review that evidence and activate its exact code-managed prompt digest with `npm run prompt:activate:prod` from the immutable image, following `deploy/prompt-release.md`.
4. Run the provider sandbox verifier with `SANDBOX_PERSIST_ONBOARDING_EVIDENCE=true` to prove a reversible Square appointment plus signed Square and Twilio callbacks.
5. `POST /v1/onboarding/simulations` to persist a deterministic result for every critical launch check.
6. Correct any failed checks and run the evidence and simulation steps again.
7. `POST /v1/onboarding/activate` to activate production automation using the latest passing run.
8. `GET /v1/onboarding` to read the activation, latest run, current health, and whether configuration has changed since testing.

The `communication_policy` check is critical. A manager must publish versioned transactional and marketing disclosure references, a named escalation contact, client-local contact hours, and a default 7–365 day rebooking interval through the protected location settings contract. All automated recovery, abandoned-enquiry, missed-call, and review outreach uses that contact window. A completed appointment without an explicit rebooking date uses the configured default interval. See `deploy/communication-policy.md` for the operating and legal-review boundary.

Migrations `032_onboarding_provider_verification.sql` and `043_prompt_release_provenance.sql` add immutable, tenant-scoped provider proof and cryptographic prompt provenance. Activation now requires a passing model evaluation of at least 150 cases from the last seven days, with the exact active prompt digest and model, 100% safety and confirmation accuracy, and zero grounding violations. It also requires provider evidence from the last 24 hours, generated after the latest Square, catalog, staff, or messaging configuration change. That evidence must show a Square sandbox appointment was created, retrieved, and cancelled, a controlled Twilio message was accepted, and both signed provider callbacks were observed in the tenant event ledger.

Every onboarding run stores a SHA-256 fingerprint that includes the authoritative configuration and exact evidence records. The immutable run and its chained audit are committed together. Activation fails if settings, provider connections, synchronized catalog, clients, channel routing, billing, prompt/model evidence, or provider proof changed after the passing run. A configuration change invalidates older provider proof even when it is otherwise within 24 hours. Successful activation locks and revalidates the latest passing run, then commits the active location state, onboarding-scoped workflow resumptions, immutable event, outbox record, and chained audit in one transaction. Any event or audit collision rolls the entire activation back, leaving the location and paused jobs unchanged.

Set `ONBOARDING_ENFORCEMENT_ENABLED=true` to exercise the gate outside production; production enables it automatically. Consent and opt-out operations, provider webhooks, billing recovery, approvals, and onboarding itself remain available while draft locations are blocked. New outbound messages, holds, waitlist enrollment, and report scheduling are paused until activation.

## Conversation runtime foundation

Migration `014_conversation_runtime.sql` adds tenant-scoped conversations and messages, versioned prompts, and immutable agent-run records. Signed Twilio inbound messages resolve the destination location, deduplicate by provider message ID, store the customer text inside the tenant boundary, and publish only redacted message metadata to the event outbox. Migration `050_client_contact_resolution.sql` adds the scoped contact lookup used to bind a unique imported profile to inbound SMS and WhatsApp; WhatsApp's provider prefix is removed only for profile matching and retained on the conversation address. Shared or unknown contacts are never assigned to an arbitrary profile, so their conversations remain safely unbound until identity is established.

Deterministic code runs before any model request:

- opt-out language closes the conversation and immediately records a channel opt-out;
- medical/safety language, refund or legal demands, policy exceptions, and explicit requests for a person escalate the thread;
- escalations atomically create one deduplicated `service_recovery` approval and one immutable request event without generating a customer reply;
- model output is always a draft and cannot directly call booking, messaging, consent, or money tools.

Every accepted inbound message now schedules one deduplicated `conversation_turn` job. The webhook returns without waiting for a model request; the separate worker prepares the draft and immutable agent-run record. Completed or deterministic runs are idempotent by input message, while transient provider failures remain retryable through the persisted workflow queue with bounded exponential backoff. Non-retryable failures and exhausted retries enter the existing manager approval path.

When `OPENAI_API_KEY` is configured, the worker and `POST /v1/conversations/:conversationId/route` use the Responses API with a strict structured-output schema. They receive at most the last eight redacted messages plus verified location, service, and staff facts, use `MODEL_CONCIERGE` (default `gpt-5.6-terra`) at low reasoning effort, disable response storage, and record the exact prompt version and result. `OPENAI_TIMEOUT_MS` defaults to 20 seconds and is bounded from 1–60 seconds. SDK retries are disabled so the durable workflow queue is the sole automatic retry authority; this prevents invisible duplicate attempts and keeps retry evidence attributable. Production routing first requires the active database prompt to match the code-managed release and SHA-256 digest; missing or drifted prompt state fails closed with `503`. Without a key, the same paths use a conservative deterministic router and mark the agent run as skipped after the same prompt-release check.

Unknown workflow exceptions are persisted as bounded dependency codes, never raw exception messages. Controlled pause, reschedule, and permanent-policy errors retain their non-sensitive operator detail. Terminal approvals therefore expose enough information to decide a replay without copying provider payloads, customer contact details, or model text into queue state.

Each model turn also receives a deterministic verified-context projection built from tenant-scoped records: a validated client timezone, channel-and-purpose consent states, at most three recorded upcoming appointments, and any appointment action awaiting confirmation. Appointment facts may include a verified service/staff label, time, price, currency, and provider class, but never tenant/client/conversation IDs, internal or provider booking references, contact details, confirmation tokens, profile names, or cross-tenant data. The short factual summary is regenerated from those bounded records on every turn rather than written by a model, so it cannot become stale free-form memory or an instruction channel. Invalid timezone text is excluded rather than forwarded.

Conversation classification is an internal safety operation, so it remains active while billing or onboarding blocks outbound automation. The worker never sends its draft. Only the reply endpoint can deliver it, after exact-purpose consent, billing, and activation checks.

## Audited booking specialist

Migration `015_booking_tool_calls.sql` adds immutable, tenant/location-scoped records for every booking-specialist function call. Routine booking, service, price, and availability intents now pass from the router to a separate bounded Responses API function-calling loop. The specialist can use only:

- `get_salon_information`;
- `list_services` and `get_service_details`;
- `list_staff`;
- `search_availability`;
- `create_temporary_hold`.

Arguments are parsed again with server-side schemas, and all facts come from synchronized location data or the Square booking gateway. The loop preserves model function-call items and returns application results by provider `call_id`, stops after four model steps, records completed and failed calls, and retries transient provider failures through the durable conversation job. Each tenant-scoped tool-call record and its chained audit evidence now commit in one transaction after the referenced conversation and inbound message are locked. Audit input comes only from the already-redacted trace record, results are bounded to identifiers and status, and an audit collision rolls back the tool trace. Provider `call_id` retries return the existing ledger entry instead of creating duplicate evidence.

Migration `048_booking_tool_knowledge_constraint.sql` aligns the production tool ledger constraint with the approved `search_support_knowledge` function added by the governed knowledge base.

The model cannot supply a tenant, client, price, currency, Square customer identifier, or confirmation token. Temporary-hold code resolves those values from the authenticated conversation and authoritative records, revalidates the exact Square slot, and withholds the token from model output. Hold creation also rechecks onboarding and billing even though read-only safety classification remains available before activation. No final booking, cancellation, reschedule, messaging, consent, refund, or payment tool is exposed; those mutations retain their existing explicit-confirmation or human-approval boundaries.

## Approved support knowledge base

Migration `033_support_knowledge_base.sql` adds tenant/location-scoped support articles plus an immutable version history. Managers create a new version through `PUT /v1/support/knowledge/:slug`, selecting `draft`, `published`, or `archived`. `GET /v1/support/knowledge` returns every current article to managers for governance. Publishing never overwrites history: the current article, immutable version row, and PII-safe chained audit commit in one locked transaction. A version conflict or audit collision preserves the previously approved content, so customer-facing grounded guidance cannot change without provenance. Each version records its manager, SHA-256 content hash, state, and timestamp.

Only the current `published` version is available through operator `POST /v1/support/knowledge/search` or the agent's `search_support_knowledge` tool. Retrieval is deterministic: normalized query terms are scored against approved topics, title, summary, and content, results are bounded to five articles, and a weak match returns `grounded: false` rather than a guessed answer. Draft, archived, stale-version, and cross-tenant content is excluded before model context is created.

The tool is read-only and audited like every booking-specialist call. It is intended for approved facts such as lateness, deposits, preparation, aftercare, accessibility, and opening arrangements. The booking specialist must state that approved information is unavailable when retrieval is ungrounded; it cannot substitute general model knowledge. Article writes reject likely credentials, API tokens, private keys, system prompts, and restricted internal instructions. Audit records retain the slug, state, version, and content hash—not the article body.

## Public acquisition and recovery review

Migration `034_public_recovery_reviews.sql` adds the public, non-tenant acquisition intake used by the marketing site. `/` serves the generic calculator-first experience, `/for/<location-slug>` provides a location-specific variant, and `/app` preserves the authenticated operations workspace and fictional sandbox.

The public review endpoint combines a honeypot, shared per-source request limits, and production-mandatory Cloudflare Turnstile verification. Migration `044_public_rate_limits.sql` makes the budget atomic across every API replica and deployment restart. Source addresses are HMAC-SHA256 transformed with `PUBLIC_RATE_LIMIT_HASH_KEY` before the store boundary; PostgreSQL receives only the 64-character digest, fixed window, route key, and counters, and purges expired digests after two days. Production trusts exactly one forwarding hop by default because the private API security group accepts traffic only from the application load balancer; `PUBLIC_TRUST_PROXY_HOPS` must match any deliberate ingress topology change. The SPA explicitly renders the challenge with action `recovery_review`; the API independently redeems each single-use token through Siteverify, verifies the configured hostname and action, and fails closed on invalid evidence or provider unavailability. Challenge tokens, Turnstile secrets, IP addresses, and provider responses are never copied into prospect records. Configure `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAMES`, and a separate random `PUBLIC_RATE_LIMIT_HASH_KEY` of at least 32 bytes at API runtime, and embed only the public `VITE_TURNSTILE_SITE_KEY` during the immutable image build.

`POST /public/recovery-reviews` is intentionally outside the tenant session boundary because it receives prospects, not salon customer records. The route applies strict schema validation, an invisible honeypot, distributed source throttling, idempotent submission keys, `no-store` responses, and a generic accepted response for detected bot traffic. The server recomputes the illustrative recovery estimate from the submitted operating assumptions; it never accepts a browser-computed revenue total as authoritative.

Each accepted record captures the direct request, source path, qualification answers, calculator assumptions, privacy-notice version, one-year retention deadline, and exact marketing-consent state. A direct recovery-review request may be answered to fulfil that request. Ongoing nurture is allowed only when `marketingConsent` is true and `marketingConsentCapturedAt` is present. No outbound campaign or automatic tenant creation is triggered by this endpoint.

Configure `PUBLIC_REVIEW_RATE_LIMIT_WINDOW_SECONDS` and `PUBLIC_REVIEW_RATE_LIMIT_REQUESTS` for the public boundary. The database counter is the authoritative application limit; WAF rate-based protection remains the coarser edge control.

## Deterministic appointment confirmation

Migration `016_conversation_confirmations.sql` adds tenant/location-scoped conversation actions and permits only one active booking action per conversation. Creating a temporary hold records a `prepared` action, but that state does not authorize a booking. The action advances to `awaiting_confirmation` only after an operator sends the exact linked draft body through `POST /v1/conversations/:conversationId/replies` with its `draftMessageId`. After Twilio accepts the send, the sent message, conversation timestamp, action transition, and chained audit commit in one transaction. The provider idempotency key derives from the action ID; repeating a committed request returns the existing confirmation message without sending again. Edited summaries are rejected before provider delivery, and audit failure preserves the prepared action without exposing a sent message locally.

Migration `017_booking_mutation_confirmations.sql` extends the same state machine to `cancel_appointment` and `reschedule_appointment`. `POST /v1/conversations/:conversationId/booking-actions` verifies that the booking belongs to the conversation client and prepares a factual, expiring draft. The repository locks the conversation and its single-active-action slot, then inserts the exact draft, prepared action, and chained audit in one transaction; an audit or active-action conflict exposes neither record. Rescheduling creates a new provider-validated hold for the exact replacement service, staff member, time, price, and currency. Cancellation records the auditable customer reason without releasing or changing the current appointment.

Inbound confirmation is resolved by deterministic code before safety routing or any model request. The exact phrases are action-specific: `Yes, book it.`, `Yes, cancel it.`, or `Yes, reschedule it.` A plain `Yes`, short acknowledgement, emoji, question, silence, or expanded statement is not confirmation and produces a factual clarification draft. After the idempotent provider booking mutation commits, the repository locks the awaiting action, inbound confirmation message, and resulting booking before committing the terminal action plus its redacted chained audit. If that evidence commit fails, retrying the same message reuses the provider booking and repairs the action without a second provider mutation. `No, keep it.` and late replies use one terminal transaction: the awaiting action and inbound reply are locked, any active booking/reschedule hold is released, an `appointment.hold_released` event/outbox record is emitted only for a real release, and the cancelled/expired action plus redacted audit commit together. Failure preserves both the awaiting action and hold; an existing appointment remains unchanged.

An exact affirmative executes only the server-held action. The confirmation token never enters the model or customer-visible draft. Every write uses a stable action-derived idempotency key, so retrying the same inbound message cannot duplicate a provider mutation. Successful events enter the existing confirmation, reminder, waitlist, and recovery workflows. Expired actions and missing holds fail closed. Cancellation and rescheduling remain available for existing customers when onboarding or billing pauses new revenue automation. Every transition is tenant scoped and audited.

Operator routes:

- `GET /v1/conversations` lists tenant/location threads with their latest message and matched client profile.
- `GET /v1/conversations/:conversationId` returns the thread, consent evidence, agent-run history, booking tool-call trace, and confirmation actions.
- `POST /v1/conversations/intake` creates sandbox test messages through the same safety boundary.
- `POST /v1/conversations/:conversationId/route` prepares a traceable draft or escalation.
- `POST /v1/conversations/:conversationId/booking-actions` prepares a client-scoped cancellation or replacement-slot summary without executing it.
- `POST /v1/conversations/:conversationId/replies` sends through exact-purpose consent before recording the outbound message. New-booking and ordinary replies also require active billing and onboarding; an exact linked cancellation/reschedule draft remains available for an existing customer. Supplying `draftMessageId` requires the exact, unedited stored draft and can arm its matching action.

The React Conversations workspace consumes these routes whenever `VITE_DEV_AUTH_TOKEN` is configured; otherwise it retains the visual sample workspace. Live booking drafts expose a `Use verified draft` action, remove verification immediately when edited, and show the current hold/confirmation state in the client context panel.

## Abandoned-enquiry recovery

Migration `018_abandoned_enquiry_followups.sql` adds a durable follow-up ledger keyed to the workflow job, conversation, client, and exact outbound trigger message. Migration `052_conversation_followup_channel.sql` binds every reservation to the authoritative SMS or WhatsApp conversation channel, backfills legacy evidence, and carries that channel through privacy exports, the immutable completion event, and the chained audit. A replay that tries to switch channels fails closed. An ordinary transactional reply schedules a follow-up only for booking, price, service, or availability intents. Appointment confirmation actions are excluded because their hold and customer-confirmation lifecycle already has a separate state machine.

At execution time, the worker reloads the tenant-scoped thread and closes the attempt without messaging if the customer or operator progressed the conversation, the thread is unavailable or escalated, an appointment action is pending, or the client already has a future booking. It resolves the client's timezone and salon sender from authoritative records, requires exact transactional consent with no channel opt-out, and applies the same 09:00–19:59 local delivery window as recovery campaigns.

An eligible thread receives one factual prompt to continue the appointment request. The message does not claim a slot is available, held, or confirmed. After the provider accepts the SMS, the repository locks the reserved attempt and current conversation version, then atomically stores the system message, advances the thread, marks the attempt sent, emits `conversation.followup_sent` through the outbox, and appends its PII-redacted chained audit. A collision or stale thread version leaves every local record unchanged so the provider-idempotent delivery can be reconciled safely on retry. The persisted sent ledger caps the workflow to one follow-up per conversation in a rolling 24-hour period; later eligible jobs close with `recent_followup` instead of sending again.

## Missed-call SMS recovery

Migration `019_missed_call_recovery.sql` adds an auditable ledger for missed inbound calls and their SMS outcomes. Configure the Twilio voice status callback to `POST /webhooks/twilio/voice/status` and set `TWILIO_VOICE_STATUS_WEBHOOK_URL` to that exact public URL. The ingester verifies Twilio's signature, resolves the tenant from the called destination number, and stores a deterministic provider event. Repeated callbacks for the same call and terminal status cannot create duplicate recovery jobs.

Only inbound calls ending as `busy`, `failed`, `no-answer`, or `canceled` produce `call.missed`. The worker waits two minutes, then texts only when the caller matches an authoritative client profile with exact transactional SMS consent and no channel opt-out. Unknown callers and callers without consent are recorded as closed attempts rather than silently enrolled. If the caller has already sent an SMS since the missed call, recovery stops with `conversation_progressed`.

Delivery is limited to 09:00–19:59 in the client's timezone and to one sent missed-call recovery per caller every 24 hours. After Twilio accepts the factual message, the repository serializes completions for that caller and atomically creates or advances the tenant-scoped conversation, stores its system message, marks the recovery attempt sent, emits `call.recovery_sent` through the outbox, and appends the PII-redacted chained audit. A stale conversation or evidence collision rolls back the entire local completion, leaving the provider-idempotent delivery available for safe reconciliation. `GET /v1/missed-call-recoveries` is manager-only and returns the tenant/location ledger without crossing account boundaries.

## Durable outbound delivery and receipts

Migration `021_outbound_message_delivery.sql` adds one durable outbound record per tenant/location idempotency key. The reservation is committed before Twilio is called, so separate API or worker processes cannot send the same logical message twice. A reservation whose provider result is uncertain is never replayed automatically; it remains visible for operator reconciliation rather than risking a duplicate customer message.

Configure `TWILIO_STATUS_CALLBACK_URL` to the exact public `POST /webhooks/twilio/status` URL and configure Twilio to send message status callbacks there. The ingester verifies `X-Twilio-Signature` against that exact URL, resolves the salon from the signed sender number, stores and deduplicates the original provider callback, and then advances the matching message through `accepted`, `queued`, `sending`, `sent`, `delivered`, `failed`, or `undelivered`. Terminal states cannot be rolled backward by delayed callbacks. WhatsApp `read` is normalized to delivered.

Matched conversation messages receive the same normalized delivery result. A transactional failure or undelivered receipt opens one deduplicated `message_delivery_failure` approval; marketing failures remain in the ledger without creating a human task. Tenant health separately warns about failed receipts from the last 24 hours and reservations open for more than ten minutes. This runtime warning is intentionally not part of the pre-activation credential and route check.

## Neutral review requests and feedback recovery

Migration `022_review_requests.sql` adds one durable review decision per completed appointment. Migration `054_review_request_channel.sql` binds that decision to its consent-authorized SMS or WhatsApp channel and safely backfills legacy evidence as SMS. An `appointment.completed` event schedules the request for 24 hours later while retaining the existing service-specific rebooking workflow. The worker defaults legacy events to SMS; an explicit channel must match the active location Twilio route and have exact marketing consent for that channel. It observes the 09:00–19:59 local delivery window and applies the same 90-day cap to every client. Missing consent, contact data, or a configured `publicReviewUrl` closes the request with an auditable reason instead of opening a retry approval.

Every sent message asks for honest feedback and includes the same public review link without asking for a positive rating, gating the link on sentiment, or offering a reward. The selected channel is immutable across workflow retries and remains visible in the manager ledger, privacy export, reservation and completion audits, and the durable `review.requested` event emitted only after provider acceptance. A negative reply received within 14 days is detected before model routing, marks the conversation escalated, opens one service-recovery approval, links that approval and inbound message to the review record, and emits `review.feedback_received`. The review link is never withdrawn based on the response. Weekly reports include sent, policy-closed, and negative-feedback counts.
