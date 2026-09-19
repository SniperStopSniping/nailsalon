# Review-request automation schema release note

Migration `0081_review_request_automation_contract` is additive and inert. It
adds salon policy fields and a durable `review_request_trigger` queue record;
it neither scans appointments nor creates or sends a message.

Apply it through the guarded environment-specific database commands before any
deployment that reads the new Drizzle columns. Do not apply it as part of this
navigation change, do not backfill historical appointments, and do not enable
automation only because the columns exist. The existing migration `0078`
readiness issue remains separate from this contract.

`scheduled_for` is immutable after a trigger is created. Changing a salon delay
therefore affects later triggers only; a later implementation must supersede,
not retime, an unresolved trigger when an appointment changes.

The accompanying pure policy resolver is not wired into runtime scheduling.
Missing and legacy settings preserve manual/completion modes and the lifetime
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
