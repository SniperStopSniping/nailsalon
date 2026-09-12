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
were changed. Review migration execution so far was limited to disposable CI
PostgreSQL and PGlite. Shared Development/Preview/Production ledgers have not been
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
