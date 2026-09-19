# Scheduled-end review event capture

This slice adds a producer for explicitly configured `scheduled_end` salons.
It does not enable salons, change legacy completion/manual defaults, remove
lifetime uniqueness constraints, add email fallback, or contact providers.
The recommended setup policy remains scheduled end plus 60 minutes and a
90-day repeat cooldown; applying that policy requires the later settings and
repeat-history rollout.

## Eligibility and timing

- Salon must be active and the appointment must be undeleted, confirmed,
  in progress, or completed. Pending, declined, cancelled and no-show records
  are excluded. Booking origin and payment state do not introduce extra paths.
- Valid creation/start/end timestamps, start before end, creation no later than
  end, and end reached are required. End must be strictly after enablement.
- The event snapshots salon, appointment, trigger kind/time, start/end and
  policy revision. A complete unique identity prevents replay. Due time is end
  plus the configured delay; expiry is due plus 24 hours. Neither moves on retry.
- Previously captured identities in every state are removed before limiting
  the candidate query. Capture is capped at five per salon and fifty per pass.
  Sendable events precede expired events after outages; expired events get one
  skipped history record, never a late request.

## Transactions and dispatch

Capture takes the review fence, appointment NOWAIT lock, and salon SHARE
NOWAIT lock, then rereads appointment, salon and settings. Materialization keeps
the existing client-before-appointment lock order and revalidates identity,
policy, consent, suppression, Google link and request history. All old dispatcher
and maintenance phases run before review work. Capture and materialization
share a 15-second monotonic admission budget, not a hard wall-clock guarantee;
individual production transactions retain lock/statement timeouts.

A rescheduled appointment may replace its own obsolete linked automatic
reservation only while the intent is pending, claimed or credit-blocked and has
no provider acceptance evidence. The intent row lock and guarded update share
the dispatcher's TX1 boundary. Sending and unknown outcomes stay reserved;
replacement events retry until immutable expiry. Manual and unlinked legacy
requests are preserved. Existing dispatcher credit settlement remains unchanged.

The existing two pre-provider validation boundaries also validate scheduled-end
identity. Cancellation/no-show must be marked **before the request sends**.
Cancellation after provider acceptance cannot retract the message. Owners see
the scheduled request without a contradictory completion-required reason.

## Release gates

- Apply the additive trigger contract and nullable completion migration in
  their documented order before a deployment reads or writes the new schema.
- The mandatory disposable-PostgreSQL CI suite executes fifteen tests with no
  skips, including scanner uniqueness, lock contention and real dispatcher
  orderings. PGlite covers eligibility/history but does not prove concurrency.
- Recheck Owner Assistant and Customer AI compatibility at the final integrated
  head. There is no AI-specific scheduling path or change to L1 authority.
- Obtain representative PostgreSQL candidate-query plan/volume evidence before
  activation; do not add an index or claim latency from small PGlite fixtures.
- Complete settings/status/history and all-writer repeat coordination before
  removing lifetime constraints or exposing the finite-repeat policy.
- Production migrations, provider tests and activation remain separate release
  actions; this source slice performs none of them.
