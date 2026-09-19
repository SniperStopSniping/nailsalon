# Review-request automation schema release note

Migration `0081_review_request_automation_contract` is additive and inert. It
adds salon policy fields and a durable `review_request_trigger` queue record;
it neither scans appointments nor creates or sends a message.

Apply it through the guarded environment-specific database commands before any
deployment that reads the new Drizzle columns. Do not apply it as part of this
navigation change, do not backfill historical appointments, and do not enable
automation only because the columns exist. Readiness for any earlier migration,
including `0078`, must be established separately in the target environment.

`scheduled_for` is immutable after a trigger is created. Changing a salon delay
therefore affects later triggers only; a later implementation must supersede,
not retime, an unresolved trigger when an appointment changes.

The policy resolver preserves missing and legacy manual/completion modes and the lifetime
repeat limit. The explicit new-salon recommendation is scheduled end plus
60 minutes and a 90-day cooldown. New and existing owners must deliberately
adopt the new policy; adding columns does not make that choice for them.

The compatibility phase retains `review_request.completed_at NOT NULL` and
the existing client/phone lifetime unique indexes. Scheduled-end dispatch and
repeat requests therefore cannot be enabled by this migration alone. Later
writer and constraint transitions need separate review and release gates.
Trigger identity includes both appointment start and end snapshots so changing
the start while retaining the end can supersede an unresolved decision.

Source validation: 78 focused policy, migration, purge and preview-fixture tests
passed using isolated PGlite; type checking and exact-file lint passed. Schema
generation reports no remaining diff. Independent source review approved the
contract. This is not evidence of PostgreSQL lock-race behavior, a migrated
Preview/Production database, or delivery through a real provider.

## Completion-trigger compatibility slice

The subsequent runtime slice records a durable trigger inside a newly successful
completion transaction instead of allocating a review request there. It uses the
fresh completed appointment row, preserves the existing financial lock order,
and adds no client lock, message intent or provider call to completion. It does
not scan historical appointments or produce scheduled-end triggers.

The existing communications cron dispatches messages and finishes its established
maintenance phases first. It then materializes a bounded batch of review
triggers into the existing request/intent model. Triggers are ready for allocation
immediately; their messages keep the original completion-plus-delay due time and
due-plus-24-hours expiry. An immediately due request may therefore wait one
additional cron tick. No exact send-time or delivery guarantee is introduced.

The batch admission budget is checked between rows; it is not a hard total
wall-clock deadline for an in-progress transaction. PostgreSQL statements and
lock waits have local timeouts. Retry backoff changes only the next attempt time,
never the original due time or expiry. Each batch selects at most one ready
trigger per salon, ordered by oldest readiness across salons.

Manual scheduling, settings changes, suppression, and materialization share a
short transaction-scoped review fence. The retention PATCH merges its actual
partial payload inside that fence so an unrelated parking edit cannot restore
an old Google review URL. Existing lifecycle locks protect mutable client
contact. The worker rechecks appointment snapshots, activation, eligibility,
consent, suppression and lifetime reservations; linked requests additionally
revalidate their trigger at both existing pre-provider checks. Existing requests
without a trigger retain their previous send checks. No provider call holds a
database transaction open.

This slice retains lifetime deduplication and the completed-at requirement.
Scheduled-end mode, finite repeat cooldown, settings controls, and richer history
are later slices. No AI-specific producer or eligibility branch is introduced.

Local evidence includes 103 appointment/reminder regression checks, 65 completion
and SMS/email dispatcher checks, and three cron ordering/failure-isolation checks.
The focused review/settings tests use isolated PGlite and mocks. Seven additional
transaction/lock cases must execute with zero skips against the CI job's attested
disposable PostgreSQL server, followed by the unchanged Customer AI persistence
and real-handler mobile gates. Local no-target skips are not PostgreSQL evidence.
