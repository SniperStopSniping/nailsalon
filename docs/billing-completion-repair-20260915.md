# Billing completion repair — 2026-09-15

## Scope and authorization

Owner-authorized bounded code/readiness repairs, focused tests, disposable PostgreSQL,
independent payment-safety review, exact-head CI and normal green merge. Billing stays
dark. No Stripe/Vercel configuration, payments, secrets, switch activation, starter
grants, production migrations/data changes, or pilot execution.

## Refund invariant (§6.7)

A fully refunded invoice cannot fund future monthly grants or upgrade differences,
even after reconciliation, delayed paid events, replay, or concurrent processing.
Previously issued/consumed credits are not clawed back; purchased credits are unaffected.
A later disjoint paid renewal remains eligible. A late refund of an older invoice
must not erase that later coverage.

The repair stores invoice identity and half-open refunded period boundaries as ISO
strings in the existing transactional `billing_subscription_refund_applied` audit row.
It records the fact even if `paidThrough` was not advanced yet. All reads/writes use
the existing subscription row lock and scope facts by salon and subscription identity.
Payment projection rejects refunded coverage; both window grants and upgrade differences
exclude refunded intervals independently of the mutable `paidThrough` scalar. No schema
change is needed. These audit rows are financial state and must remain for the
subscription lifetime. Legacy/malformed refund facts fail closed pending review.

Refund events for an owned but not-yet-projected subscription remain retryable.
The parked refund-anomaly tests were copied into this repair; the original worktree
is preserved. Missing cumulative top-up refund evidence is held, never interpreted as zero.

## Delivery evidence

Refund repair local evidence: 144 focused tests across checkout/top-up, webhook,
subscription projection, reconciliation, and grants passed; eight real PostgreSQL 16
regressions passed against a private disposable loopback database. The new PG suite
is included in the existing CI financial concurrency job and accepts its guarded
loopback/disposable confirmation (it does not silently skip because of a local-only
DB name). Independent high-risk payment-safety review found no remaining static
blocker after malformed coverage, paid-period validation and terminal delayed-event
handling were repaired.

Broad local validation encountered resource failures: the full Vitest process
exhausted its heap (including timing failures during contention), and the Next build
reported ENOSPC. These runs are not counted as passes. Required exact-head CI,
including full-suite shards and both Node builds, remains the delivery gate. The
focused top-up suite was rerun cleanly after resource recovery. Immutable PR/CI
evidence is authoritative.

Refund repair [PR #224](https://github.com/SniperStopSniping/nailsalon/pull/224)
merged as `fd1058c1c4e8e9f30e39be05e090e64250df9bd5` after exact-head CI
`35016462439` passed every gate. Its SMS-credit PostgreSQL job ran all eight
refund regressions as part of 20 passing tests with zero skips. This supersedes
the pending delivery gate above; it does not establish a pilot pass.

The follow-on readiness repair separates dark deployment from pre-activation
configuration evidence. Missing/malformed credentials, incomplete carriers,
wrong-mode/disabled/wrong-target endpoints, and failed requested health checks
cannot yield activation readiness. Supplying the correct dedicated webhook
secret makes billing non-dark without incorrectly failing pre-activation evidence.
49 focused readiness tests pass locally, including CLI output and safe diagnostics.
The original Preview tooling remains parked; only its useful protected-health
access pattern was salvaged. Provider resource authenticity, account ownership,
catalogue amounts, portal settings, and legacy isolation are still manual rehearsal
prerequisites; this offline checker does not prove them or authorize activation.

## Open decisions and rehearsal gates

- D19c: explicitly amend §5/§8.1's byte-identical legacy webhook restriction to permit
  ignoring new-track checkout sessions **and subscription/invoice lifecycle events**,
  preserving legacy processing and keeping endpoint deduplication separate. The current
  conditional instruction does not ratify that amendment. P9 boilerplate deletion is
  separate and unnecessary for this fix.
- D10: anti-abuse retention/deletion policy; separate from retaining financial refund facts.
- D11: seven publication approvals remain outstanding; public pricing/tax/promotion stay off.
- P8b operations panel remains optional.
- Before any rehearsal: reviewed code SHA, passing required CI/review, explicit Preview-only
  authorization, isolated Preview DB/Clerk test owner, exact Stripe test catalogue and
  portal configuration, webhook legacy isolation and event selection, branch-scoped
  configuration, positive readiness evidence, and manually verified scheduler execution
  on Preview. Never infer deployed cron execution from entries in `vercel.json` alone.
- Rehearsal evidence must cover duplicate checkout, refund/reconcile/grant ordering,
  one-time starter grant, top-up history, subscription cycle, tenant isolation, clean
  integrity/drift reports, and the deployed SHA. None has been executed by this repair.
