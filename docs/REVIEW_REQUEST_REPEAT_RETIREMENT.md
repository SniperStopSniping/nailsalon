# Repeat-review index retirement

Migration 0084 removes only `review_request_client_once` and `review_request_phone_once`. It preserves request/intent identity, trigger uniqueness, active-appointment uniqueness, and history indexes. It does not rewrite existing requests, change salon policies, or backfill appointments.

Deploy all coordinated review writers before applying this migration and drain processes running earlier writers. Manual appointment actions, explicit client Google-review presets, completion triggers, scheduled-end materialization, legacy owner-marked history, suppression, and dispatch must use the shared salon fence/history rules. Existing null repeat settings continue to mean never-repeat. New setup recommends an explicit 90-day cooldown; that recommendation is not applied to existing salons implicitly.

A Production apply requires separate authorization and the migration runbook. Recreating the old lifetime indexes is not a safe automatic rollback once a client has legitimate repeat history. Roll back by pausing new review admission while retaining history, then use a reviewed forward repair. Do not delete repeat requests to make old uniqueness constraints pass.

## Required evidence

- Local PGlite migration/schema/fixture and ledger upgrade checks.
- Nine mandatory real PostgreSQL tests with zero skips on the attested disposable CI target: actual producer/manual contention in both orders, late cross-purpose idempotency collisions in both orders, finite and legacy cooldown behavior, owner-reported history/STOP/unknown outcomes, same-appointment protection, and later-visit admission.
- Query-plan artifact using the actual production scanner SQL template with uneven synthetic salon backlogs, captured/uncaptured identities, and expired/current appointments. It records ANALYZE/BUFFERS and verifies fairness; it is not Production capacity proof.
- Protected Customer AI and Owner Assistant regressions plus normal CI/Preview release gates on the eventual integrated head.

No local shared PostgreSQL instance, live recipient, external SMS provider, or Production configuration is part of this verification.
