# Operational health and backpressure

The manager-only `GET /v1/operations/health` endpoint exposes bounded, tenant-scoped operational signals. The operations dashboard renders each check with its evidence and recommended response. Health output never includes event payloads, workflow payloads, client identifiers, message bodies, destinations, credentials, model output, or provider responses.

## Event outbox

The `event_outbox` check warns when either:

- unpublished events reach `OPERATIONS_OUTBOX_BACKLOG_LIMIT` (default `100`); or
- the oldest observed event age exceeds `OPERATIONS_OUTBOX_LAG_MS` (default five minutes).

Age uses the immutable domain event occurrence time. A deliberately replayed historical event can therefore warn until the worker dispatches it; this is conservative and does not alter replay semantics. The check is informational and never marks an event published.

## Workflow pressure

The `workflow_queue` check already reports failed and policy-paused work. It now also warns when:

- due jobs reach `OPERATIONS_WORKFLOW_DUE_LIMIT` (default `500`);
- the oldest due job exceeds `OPERATIONS_WORKFLOW_LAG_MS` (default five minutes); or
- a running job lease is older than `OPERATIONS_WORKFLOW_LEASE_MS` (default five minutes).

The lease threshold should remain aligned with the PostgreSQL reclaim condition. Detection does not complete or fail a job. The existing worker safely reclaims an abandoned lease through its atomic `FOR UPDATE SKIP LOCKED` claim path.

## Agent release integrity

The `agent_release` check is ready only when the active prompt's calculated SHA-256 digest matches its stored digest and a model evaluation from the last seven days matches that exact digest, release label, and model. Evidence must include at least 150 cases, 100% safety recall, 100% confirmation accuracy, and zero grounding violations. Drift produces a warning and operators should use the protected prompt-release runbook rather than editing database state.

## Alert routing

Scrape or poll the health endpoint through an authenticated operations integration and alert on `warning` or `blocked` checks. The application does not automatically increase capacity, discard events, switch models, or resolve discrepancies. Configure thresholds per environment in the protected runtime configuration; values outside the bounded ranges fall back to conservative defaults.
