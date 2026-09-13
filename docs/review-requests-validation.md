# Review requests validation and migration coordination

## Migration allocation blocker

At validation, fetched `origin/main` was
`adf041f4a2da8b832ede4060bf7617d7f9d0a899`, ending at migration 0075.
Both pending migrations allocate index 76 and timestamp `1787476392670`:

| Branch | Migration | SHA256 |
| --- | --- | --- |
| `codex/review-requests` | `0076_review_requests` | `e29f8ccd755e19c938086186d04c816c710eaefc90ef2a5b42a36f464366a5fd` |
| `agent/d6-r1-targeted-repair-20260912` at `e2c4057464b1e57b36ced4ebce37ee85f80fc67a` | `0076_deposit_shadow_evidence` | `3626d5427a18d1762ae6e4807cb9a31f8dc093c22cc700b7a6a712a4945f1765` |

A read-only ledger/catalog query against the Stripe task's loopback PostgreSQL
cluster used the repository's static target guard, server expectation, live
session attestation, and a `BEGIN READ ONLY` / `ROLLBACK` transaction. It confirmed
the exact Stripe hash/timestamp is applied, `deposit_shadow_state` exists, and
`review_request` is absent. No rows, services, Stripe files, branches, or worktrees
were changed. Review migration execution was limited to disposable CI
PostgreSQL, PGlite, and a separate task-owned IPv6 loopback PostgreSQL cluster.
That cluster also attested the exact review hash/timestamp above. Shared Development/Preview/Production ledgers have not been
independently verified.

The current Drizzle PostgreSQL migrator selects migrations using
`lastLedger.created_at < migration.when`. Renaming a file alone does not resolve
this collision. Applying either current definition after the other can silently
skip its SQL.

Required coordination before integration/application:

1. Preserve Stripe's applied 0076 SQL/hash/timestamp.
2. Confirm retained shared/hosted ledger state and agree Stripe-first integration.
3. Then allocate Review 0077 with a unique later journal timestamp, updating its
   journal, fixture counts, CI pins, and docs while preserving its SQL content.
4. Do not apply Review 0077 before Stripe 0076; a subsequently added older Stripe
   timestamp would also be skipped.
5. If Review's original identity exists on a retained shared database, stop and
   review explicit ledger/schema reconciliation instead of renumbering it.

No allocation was changed during this validation. PR #188 remains draft; this is
an application/merge blocker, not permission to apply either migration.

## Safety test evidence

The migrated PGlite review service/dispatcher suites exercise server completion
cutoffs, no historical scheduling, shared manual/automatic identity, repeated
scheduling, post-scheduling client suppression, consent revocation and global
STOP, insufficient credits, provider rejection, and uncertain outcomes. Provider
calls are mocked. Route tests cover tenant authorization. Browser/component
checks are distinct from authenticated application tests.

The authenticated review journey is included in the existing mobile WebKit
project and CI E2E command. It requires the repository's attested disposable
PostgreSQL fixture, uses the existing super-admin password session and salon
impersonation path, and does not verify Clerk's interactive sign-in. It never
invokes the dispatcher and requires absent Twilio credentials. It verifies
persisted owner settings, completedAt-based scheduling, completion/submission
replays, Send now, queued feedback, and automation-off cancellation. Screenshots
are written to Playwright output. Delivery failure/STOP behavior is exercised by
the separate mocked-provider integration suite, not by sending browser messages.

See the PR handoff for the exact tested head, executed test counts, browser
artifacts, and unresolved gates. A test's presence is not evidence it passed.


## Executed local browser evidence

The real application iPhone WebKit run passed all four tests (two review journeys
plus existing authentication setup and teardown) in 13.0 seconds. The hardened test rejects external browser
targets and verifies the application can read its fresh attested fixture before
changing settings. It used the
existing super-admin password login and salon impersonation, real settings and
review APIs, and the real completion API. The completion checkout UI itself and
interactive Clerk sign-in were not part of this test. No dispatcher was invoked.
Screenshots cover the saved owner settings, actual recipient preview, and queued
appointment action. The cancelled request and intent remain in the database;
the action returns to manual eligibility because that request was proven unsent.

The independent component browser suite passed four tests across mobile Chromium
and iPhone WebKit. It uses production components/CSS with synthetic intercepted
APIs. It covers edited message/link previews, confirmation, exactly one Send now
POST, refreshed sent/suppressed feedback, credit-blocked and failed explanations,
44px buttons and no horizontal overflow. Screenshots were visually inspected.
This suite found the hidden credit-blocking explanation; that display was repaired.

The local application database was bound only to `::1:55432`, separate from
Stripe's `127.0.0.1:55432`. The launcher used IPv6-first DNS with family fallback
disabled, and the existing disposable-target guard plus live identity attestation
before migrations/seeding. Only synthetic reserved-range clients were created;
Twilio credentials were absent and `COMMUNICATIONS_SMS_ENABLED=false`. Automation
was disabled after testing. No hosted database or real client was contacted.
