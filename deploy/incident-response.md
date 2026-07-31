# Security incident response runbook

This runbook governs suspected confidentiality, integrity, authentication, provider-security, and availability incidents. Safety, evidence preservation, and tenant isolation take priority over workflow throughput.

## Severity

- **SEV1 — critical:** confirmed or strongly suspected credential compromise, unauthorized privileged access, material data exposure, audit-integrity failure, cross-tenant access, or a broad active attack.
- **SEV2 — high:** a contained security event with credible impact, a provider security event requiring coordinated remediation, or a sustained targeted availability attack without known data exposure.
- **SEV3 — moderate:** a suspicious signal requiring investigation with limited apparent impact, including a likely false positive that has not yet been proved.

When uncertain between severities, start at the higher severity and let the owner revise the operational response after evidence review. Do not downgrade a ledger record by rewriting history.

## Response sequence

1. **Detect and preserve.** Record exact times, immutable audit or reconciliation identifiers, provider event IDs, monitoring alert IDs, and external case IDs. Preserve source evidence in the approved restricted evidence system. Do not paste raw logs, payloads, credentials, customer identities, contact details, or message bodies into the application incident ledger.
2. **Declare.** An owner or manager creates the incident with `POST /v1/operations/security-incidents`. Use a structured category, `sev1`, `sev2`, or `sev3`, a short operational summary, and only bounded references beginning with `audit:`, `reconciliation:`, `approval:`, `provider-event:`, `external-ticket:`, or `monitor:`. Declaration creates an owner-review approval and append-only `opened` evidence.
3. **Contain.** Stop the affected path without destroying evidence. Revoke or rotate suspected provider credentials, pause impacted workflows, restrict privileged sessions, remove affected tasks from traffic, and contact the provider through its verified security channel. An owner or manager records containment with `POST /v1/operations/security-incidents/:incidentId/status` and `{"status":"contained","actionSummary":"..."}`.
4. **Eradicate.** Identify the entry point and affected scope; patch the vulnerability; invalidate exposed sessions and credentials; verify secret-manager and deployment history; and rebuild from a reviewed immutable source and image digest. Never copy a suspected secret into a command, ticket, chat, or incident summary.
5. **Recover.** Run database and audit-integrity verification, provider reconciliation, focused tests, and the full protected release validator. Restore services gradually, watch delivery and provider circuit evidence, and confirm tenant boundaries before resuming automation. Never manufacture consistency by editing local or provider state outside the reconciliation workflow.
6. **Close.** Only an authenticated owner can transition a contained incident to `resolved`, or an open incident to `false_positive`. Closure requires identity-free action text and must be supported by preserved evidence. An approval decision alone does not close an incident.
7. **Review.** For SEV1 and material SEV2 incidents, record a private post-incident review covering timeline, root cause, impact boundaries, detection gaps, containment, recovery evidence, and assigned corrective actions. The owner decides with counsel and appropriate authorities whether contractual, regulatory, insurer, provider, or affected-party notifications are required.

## Operating the ledger

All routes require an authenticated owner or manager and return `Cache-Control: no-store`:

- `POST /v1/operations/security-incidents` declares an incident.
- `GET /v1/operations/security-incidents?limit=50` returns scoped current state with append-only lifecycle events.
- `POST /v1/operations/security-incidents/:incidentId/status` records containment, owner resolution, or owner false-positive closure.
- `GET /v1/operations/health` warns while incidents remain `open` or `contained`.
- `POST /v1/reports/monthly-owner-review` includes aggregate open, contained, and active-SEV1 counts without incident narratives.

Valid transitions are `open -> contained`, `open -> false_positive`, and `contained -> resolved`. Managers can contain; owners can contain and are exclusively authorized to resolve or mark false positive. Invalid and cross-scope transitions return the same conflict response so the endpoint does not disclose another tenant's incident identifiers.

## SEV1 response guidelines

- Treat the affected credential, privileged session, or integration as compromised until proved otherwise.
- Pause unsafe outbound automation and booking mutations while preserving signed webhook and outbox evidence.
- Rotate credentials in the provider and secret manager, deploy a new immutable task revision, and invalidate the old value; do not merely restart tasks with the same secret.
- Verify the tamper-evident audit chain and review privileged actions for every potentially affected tenant/location.
- Reconcile Square and Twilio state before resuming workflows; uncertain sends remain uncertain and must not be automatically replayed.
- Use the documented restore drill when database integrity or recoverability is in question. Never restore over production as part of a drill.
- Keep customer and legal communications under owner/counsel control. The incident ledger provides operational evidence, not a legal determination or notification workflow.

## Evidence hygiene

The structured incident and audit records intentionally contain only bounded metadata. Store forensic artifacts in a separately access-controlled, retention-governed evidence system. Record only its non-secret case reference in this application. Preserve original timestamps and hashes, restrict access, and avoid transformations that destroy provenance.
