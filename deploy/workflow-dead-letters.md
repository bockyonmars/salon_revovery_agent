# Workflow dead-letter operations

Terminal workflow failures are quarantined in `workflow_dead_letters` in the same database transaction that marks the claimed job failed and opens its approval request. A worker crash therefore cannot leave a terminal job without durable failure evidence and a manager decision path.

Each immutable entry contains only tenant/location scope, workflow identifiers, attempt counts, a bounded safe failure detail, the linked approval identifier, and the failure time. Customer payloads, message bodies, destinations, credentials, raw exception text, and provider responses are not copied into the ledger.

Owners and managers can inspect the location-scoped ledger through `GET /v1/operations/workflow-dead-letters`. Operators cannot access it. Approving the linked workflow request atomically resets the failed job and returns it to the durable queue; rejecting it leaves the job closed. Neither decision edits or deletes the dead-letter entry. If an approved replay later fails terminally, the system creates a new dead letter and approval while preserving the earlier evidence.

Before approving a replay:

1. Verify the provider or policy dependency independently.
2. Reconcile any operation whose remote result could be uncertain.
3. Confirm the job remains safe and relevant for the customer.
4. Record a specific decision note in the approval inbox.

Do not approve a replay merely to clear the queue. Booking and message operations retain their own idempotency and reconciliation boundaries, but an uncertain external result must be reconciled before another attempt.
