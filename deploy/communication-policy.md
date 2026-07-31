# Location communication policy

Every production location must publish an authoritative communication policy before onboarding activation. The policy is stored with the audited location settings and contains:

- an operator-controlled policy version;
- the disclosure versions used for transactional and marketing consent capture;
- a named escalation owner and email address;
- the earliest and latest local hour for automated customer contact;
- the default post-visit rebooking interval.

Managers edit the policy through the protected **Policies** screen or `PUT /v1/location-settings`. The API validates identifiers, the escalation email, a non-empty contact window, and a rebooking interval from 7–365 days. Every update enters the tamper-evident audit chain; recursive audit redaction removes the escalation email from the audit payload.

The contact window is evaluated in the authoritative client timezone for recovery campaigns, abandoned-enquiry follow-up, missed-call recovery, and review requests. Work arriving outside the window is durably rescheduled rather than sent or discarded. A legacy location without a policy retains the conservative 09:00–20:00 fallback only so existing non-production records remain operable; the `communication_policy` health and onboarding check stays blocked, preventing production activation.

For a completed appointment with no explicit `rebookAt` value, the workflow scheduler uses the policy's default rebooking interval. An explicit authoritative appointment value still takes precedence.

Changing any material policy field immediately returns an active location to `draft` before the new settings are saved. New automation then pauses under the existing onboarding policy. The settings timestamp changes the onboarding configuration fingerprint and invalidates provider proof generated before the change, so operators must regenerate required provider evidence and complete a fresh simulation before reactivation. Saving an identical policy is idempotent and does not invalidate activation. Legal counsel remains responsible for approving disclosure text and jurisdiction-specific contact-hour requirements; the stored version identifiers are evidence references, not the disclosure text itself.
