# Security governance reviews

Production ownership includes recurring human review that cannot be delegated to application automation. Store the underlying reports in an approved, access-controlled evidence system. The release environment receives only completion timestamps and opaque references; never place findings, credentials, customer data, report URLs, or attachments in environment variables.

## Quarterly dependency review

Complete at least every 93 days and after a material runtime or supply-chain change. Record `SECURITY_DEPENDENCY_REVIEW_AT` and `SECURITY_DEPENDENCY_REVIEW_REF` only after a reviewer has:

- reviewed direct and transitive npm dependency changes, Dependabot proposals, known vulnerabilities, and any time-bounded risk acceptances;
- reviewed the pinned Node container digest and GitHub Actions commit pins;
- confirmed the lockfile-only installation and production dependency pruning still work;
- reviewed provider SDK/API versions and deprecation notices;
- confirmed secret-scanning and repository access controls remain active;
- assigned owners and deadlines for unresolved findings.

An automated vulnerability scan is evidence for the review, not a substitute for the accountable review itself.

## Quarterly access review

Complete at least every 93 days and whenever a privileged operator leaves or changes duties. Record `SECURITY_ACCESS_REVIEW_AT` and `SECURITY_ACCESS_REVIEW_REF` only after reviewing:

- identity-provider owners, managers, MFA policy, session lifetime, and role mappings;
- source repository, CI, protected release environments, and deployment permissions;
- cloud, database, backup, secret-manager, logging, monitoring, and incident-evidence access;
- Square, Twilio, Stripe, Postmark, OpenAI, DNS, and Turnstile administration;
- emergency accounts, API tokens, dormant users, service identities, and completed offboarding;
- least privilege, separation of production and staging, and evidence that shared accounts are not used.

Revoke inappropriate access before attesting. Create a tracked exception with an owner and expiry when immediate removal is unsafe.

## Enterprise penetration test

Set `SECURITY_ENTERPRISE_RELEASE=true` for a release intended to support enterprise sales. The protected release then requires `SECURITY_PENETRATION_TEST_AT` and `SECURITY_PENETRATION_TEST_REF` from an independent penetration test completed within the last 366 days.

The test scope should cover tenant isolation, authentication and MFA, authorization, public and authenticated APIs, booking confirmation controls, provider webhooks, SSRF/injection classes, secret handling, audit integrity, data export/deletion, rate limits, bot protection, deployment configuration, and a representative production-like environment. Critical and high findings must be remediated or covered by an explicitly approved, time-bounded risk decision before release.

## Protected release use

Accepted evidence references use one of these forms:

- `external-ticket:SEC-2042`
- `report:dependencies-2026-q3`
- `audit:access-review-2026-q3`
- `approval:security-risk-17`
- `monitor:supply-chain-review-42`

Run `npm run security:preflight` inside the protected release environment. The command reports only evidence ages and whether enterprise mode is active. `npm run release:validate` includes this gate; the local-only validator intentionally does not require human governance evidence and can never mark a release eligible.
