# Verified dashboard data boundary

The authenticated operations dashboard is an evidence surface, not a reporting sandbox. Production screens must render records returned by the tenant-scoped API, an explicit verified-empty state, or an explicit unavailable state. They must never retain development fixtures after a live request fails.

## Authoritative screen contracts

| Dashboard surface | Authoritative API evidence |
|---|---|
| Command centre and recovery queue | `GET /v1/recovery-cases`, `GET /v1/revenue-attribution` |
| Conversations | `GET /v1/conversations`, `GET /v1/conversations/:conversationId` |
| Campaigns | `GET /v1/experiments` |
| Clients | `GET /v1/clients` |
| Revenue ledger | `GET /v1/revenue-attribution` |
| Integrations | `GET /v1/operations/provider-circuits`, `GET /v1/operations/health` |
| Policies | `GET /v1/location-settings`, `PUT /v1/location-settings` |

Recovery-case values are potential revenue until a matching booking-attribution record exists. The UI labels these cases separately and substitutes the verified booking amount only after matching by result booking, recovery correlation, or workflow job. It never invents a client identity for a recovery case that does not contain one.

Currency totals remain separated by ISO currency. Records with no currency can remain visible as operational cases but are excluded from monetary totals. The ledger counts only booking-level attribution records and does not display inferred confidence, estimated provider availability, or synthetic performance rates.

Manual production recovery creation, case pause/resolve controls, ledger export, provider reset, and unsupported refund/discount policies remain unavailable until each action has a dedicated role-checked, validated, idempotent, and audited backend contract. Development sample mode may retain fictional records, but it is visibly labelled and is not reachable through the fail-closed production authentication path.

Regression coverage lives in `server/verified-operations.test.ts`. The full local release gate validates the mappings, deterministic agent safety set, API/frontend typechecks, and production bundle. A local pass remains non-release evidence; the protected full release gate is still required for promotion.
