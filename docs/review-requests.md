# Review requests

Settings → Messages → Review requests reuses the existing retention settings row
and Google review URL. Automation defaults off, even after a URL is saved. Presets
are immediate, 30 minutes, one, two, four, and 24 hours; default one hour. Custom
delays are deferred. Templates support `{{firstName}}`, `{{businessName}}`, and
`{{reviewLink}}`. Luster's business prefix and STOP suffix are mandatory. Preview
includes SMS credits; the ASCII default reduces cost. Existing ten-segment manual
SMS limits apply.

## Scheduling and safety

The successful appointment completion transaction creates a request using its
server-recorded `completedAt`, not its scheduled end or editable actual-end input.
Completion must follow the most recent automation enable and suppression reset
cutoffs. There is no historical appointment scan, backfill, or migration producer.
The existing five-minute communication dispatcher handles delivery and quiet hours.
Manual and immediate requests are shown as queued until accepted by the provider.

Requests reuse the current SMS pipeline: consent, global STOP, destination policy,
credits, rate limits, logging, leases, and unknown-outcome reconciliation. Unsent
requests use the current review link/template; accepted messages preserve their
body snapshot. Delivery failures display a failed state and never enable resending.

Migration `0076_review_requests.sql` adds client suppression/reset fields, review
settings to `salon_retention_settings`, and `review_request`. Apply using the guarded
database runbook before running new application code. No production migration is
included in this implementation.

The request stores salon/client/appointment identity, completion, source, normalized
phone, schedule, cancellation, and linked intent. The existing intent and delivery
record supply authoritative status, timestamps, failure reason, body, and provider
ID rather than duplicating their state machine. Business IDs preserve historical
evidence if the referenced appointment/client disappears; sending always requires
current same-salon records. Salon purge includes review requests.

Partial unique indexes allow one non-cancelled request per salon/client and per
salon/normalized phone. Each intent also has an immutable unique dedupe key.
Both records commit with completion. Sent, failed, and unknown outcomes consume the
slot; generic SMS retry explicitly rejects review requests. Only proven-unsent
cancelled/suppressed/expired attempts may release a slot for a later event.
Existing client-lineage helpers preserve historical merge identity; new merges
remain disabled by Luster. This feature never merges clients by phone.

Turning automation off cancels unsent automatic requests. Removing the URL through
Review settings cancels pending requests. Client suppression cancels unsent requests;
removing it never replays old appointments. Dispatch rechecks current appointment,
client, configuration, consent, and recipient before the provider call. Changes
after that last boundary cannot retract an already-submitted provider request,
matching the existing STOP race semantics.

Quick Edit, client communication details, and staff completion share a confirmation
with the phone and full SMS preview. Only completed eligible appointments can send.
An existing scheduled request can be brought forward without creating a second
send identity. Client profile details expose suppression. No resend control or
satisfaction-routing flow is provided.

## Tests

Feature tests use migrated in-memory PGlite and mocked providers, including route
authorization and dispatcher coverage. The Playwright settings journey uses normal
isolated owner authentication and intercepts review-settings writes, so it cannot
send real SMS. Browser execution requires the documented isolated services and
credentials. Consult the handoff for actual gate results and local limitations.
