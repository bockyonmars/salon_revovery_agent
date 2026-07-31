# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through this repository's GitHub **Security** tab by opening a private security advisory. Do not create a public issue, pull request, discussion, or support ticket containing vulnerability details.

Include the affected component, a concise impact description, safe reproduction steps, and the version or commit tested. Do not include real customer data, message content, access tokens, passwords, API keys, private keys, provider payloads, or production database extracts. Use synthetic identifiers and redact secrets from screenshots and logs.

The maintainers will acknowledge a complete report when it is reviewed, coordinate validation and remediation privately, and communicate material status changes through the advisory. Response and remediation timing depends on severity, exploitability, and the availability of a safe fix; this policy does not create a service-level or bounty commitment.

## Supported version

Security fixes are developed for the current `main` branch. Deployments must use a reviewed release built from an immutable commit and must pass the repository's release gate. Older or independently modified deployments may need to upgrade before a fix can be applied safely.

## Operational incidents

Operators handling a suspected compromise must follow [deploy/incident-response.md](deploy/incident-response.md). The application incident ledger is for structured coordination and identity-free evidence references; it is not a storage location for secrets, customer information, raw provider responses, or forensic files.

Recurring dependency, privileged-access, and enterprise penetration-test evidence is governed by [deploy/security-governance.md](deploy/security-governance.md). Local automated checks do not replace these accountable human reviews.
