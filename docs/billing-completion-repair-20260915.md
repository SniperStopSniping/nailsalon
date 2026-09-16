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

## PR-1 (refund completion) — 2026-09-15

At the merge of [#224](https://github.com/SniperStopSniping/nailsalon/pull/224), HANDOFF §3.3 items 1
and 3–10 plus the new N1 proration veto were still outstanding. PR-1 closes them:

- **R-1** — a full refund whose invoice coverage cannot be derived now writes NOTHING and holds the
  event (`SUBSCRIPTION_REFUND_COVERAGE_UNKNOWN` / `SUBSCRIPTION_REFUND_PRORATION_ONLY`). The former
  null-bound `billing_subscription_refund_applied` row made every later evidence read `incomplete`,
  failing all future grants closed with no automated way back.
- **R-2** — refund evidence becomes CORRECTABLE without deleting anything: a second append-only
  action, `billing_subscription_refund_evidence_resolved`, records a `void` or an authoritative
  `set` for one invoice, and the highest `seq` across both actions is the effective state. Three
  writers use it — the webhook, the hourly reconcile safety net, and the new super-admin endpoint
  `/api/super-admin/billing/refund-evidence` (`plan`, then `apply` with a typed `invoiceId`).
  Per §8.3 the webhook decides from an AUTHORITATIVE re-fetch of the charge, never from the
  `charge.refunded` event body: that body is a snapshot at event time, and Stripe guarantees no
  delivery order, so an out-of-order partial body would otherwise void correct evidence (and a
  stale full body would assert a refund that no longer holds). The hourly safety net closes the
  same hazard at the commit boundary and runs in BOTH directions: it voids evidence Stripe no
  longer backs, and it RE-ASSERTS a machine `void` that Stripe now contradicts (a void committed
  from a stale read can land at a higher `seq` than the applied row it supersedes, and nothing
  else would ever correct it). A `super_admin` void is never re-asserted automatically — the
  reader reports each void with the actor type that wrote it precisely so an operator's decision
  stands.
- **R-3** — an unknown paid-period start is no longer defaulted to the epoch minimum (which made
  EVERY refund overlap and turned legitimate renewals into permanent holds); it is its own anomaly,
  `PAID_PERIOD_START_UNKNOWN`.
- **R-4** — a parked downgrade applies through `applyPendingOfferAtRenewal`, so the reconcile repair
  no longer depends on the latest invoice's status or periods (Y7).
- **R-5** — invoice events are fenced by STATUS: a payment resumes service only from
  `past_due`/`unpaid`/`incomplete`, a failure only dunns `active`/`unpaid`/`trialing`, and neither
  ever writes the SUBSCRIPTION event watermark.
- **R-6** — one shared reading of invoice coverage (`invoiceLinePeriods.ts`): non-proration
  subscription lines only, paged when `has_more`, with `unknown` kept distinct from
  `no_subscription_lines` (`INVOICE_WITHOUT_LINE_PERIODS` vs `INVOICE_WITHOUT_SUBSCRIPTION_LINES`).
  A Stripe failure while paging PROPAGATES (retryable, bounded by the 8-attempt poison ladder)
  rather than collapsing into a terminal hold; `unknown` is reserved for structurally unreadable
  line sets, which no retry could change.
- **R-7** — the real-PostgreSQL refund suite proves its executed count with zero skips in CI.
- **R-8** — refund metadata is versioned (`evidenceVersion: 2`) with `seq`, `invoiceId`, `refundIds`
  and ISO bounds; the audit sanitizer serialises `Date` values instead of flattening them.

Owner decision **O2 is approved and implemented**: a charge whose cumulative `amount_refunded` falls
below its `amount` automatically voids the §6.7 exclusion recorded for its invoice, restores the
coverage through the ordinary payment transition, and alerts
(`Sentry.captureMessage('billing.subscription_refund_voided', ...)`) — written by the webhook when
the reversal is delivered and by the hourly reconcile regardless. The resulting partial refund
remains a human review item (§10).

Billing stays dark: no environment, switch, migration, Stripe or Vercel change.

Still outstanding for the pilot: PR-2 through PR-5 per the final implementation handoff, plus the
open decisions and rehearsal gates above.

## PR-2 (billing-endpoint foreign-event isolation) — 2026-09-16

The legacy `/api/webhooks/stripe` and the billing `/api/webhooks/stripe-billing` share one Stripe
platform account, and on test mode that account is also shared with every other deployment of this
codebase. PR-2 makes the billing endpoint's side of that isolation two-sided (D19c §2.3 items 1–5),
so it no longer depends on nobody ever editing metadata in the Stripe Dashboard.

**The rule, stated once.** An object is processed here **iff** it carries the new-track marker
(`metadata.purpose`, plus `metadata.luster_deployment` when `BILLING_DEPLOYMENT_MARKER` is set)
**and** resolves to a salon or row that exists in this database. A *definite* "not mine" is terminal
`ignored_foreign` — 200, no alert, no retry, `salon_id` left NULL. Only a *transient* inability to
decide stays retryable, bounded by the existing 8-attempt poison ladder. The endpoint fails toward
"not mine".

- **Item 1 — error-class taxonomy.** New `src/libs/billing/stripeFetchFailure.ts`: a decoded
  `StripeInvalidRequestError` (`resource_missing` and friends) about the object is `foreign`;
  everything else — 429, 5xx, connection resets, and deliberately also authentication/permission
  failures — is `retryable`. The old `isLocallyOwnedSubscription`'s `catch { return true }` is gone:
  a Stripe outage, or a wrong key, can no longer be read as evidence about ownership in either
  direction. The taxonomy is deposits' `classifyStripeFailure` reproduced faithfully rather than
  imported (that module reaches `@/libs/stripe`, which every suite driving this webhook mocks); the
  file says so and the two are pinned by their own suites.
- **Item 2 — invoices classify from the body first.** `invoice.subscription_details.metadata` is
  Stripe's immutable snapshot of the subscription's metadata at finalization, and every new-track
  invoice carries it. When present, ownership costs **zero Stripe calls**. `subscriptions.retrieve`
  runs only when that snapshot is absent, and is the one classification fetch §2.6 permits.
  `SUBSCRIPTION_NOT_PROJECTED` is now thrown from exactly one place — an ours-but-not-yet-projected
  subscription on the refund path — instead of standing in for every unresolved refund.
- **Item 3 — a local salon is required before any write.** `projectSubscriptionSnapshot` looks the
  salon up inside its transaction on the INSERT path and returns `{applied:false,
  anomaly:'SALON_NOT_LOCAL'}` rather than raising a foreign-key error into the retry ladder; the
  route maps it to `ignored_foreign` `FOREIGN_SALON`, never `held_anomaly`. The top-up completion and
  expiry paths apply the same rule: a local salon keeps today's retryable throw (the genuine TX2
  race), a non-local one is terminal. `applyTopupSessionExpired` keeps its throwing contract for the
  callers that cannot classify (the checkout reuse path, P4's reconciler); the classifying form is
  the new `resolveTopupSessionExpiry`.
- **Item 4 — `billing_stripe_event.salon_id` attribution.** Deliberately NOT written at claim time
  from the raw body: the column carries a real foreign key, so a foreign salon id would turn a
  terminal classification into a retry loop. `recordBillingEventSalonId` is called only after a
  handler has established the object is ours and local, with an id that came from a locally stored
  row, and carries an `EXISTS` fence as defence in depth. `ignored_foreign` rows stay NULL.
- **Item 5 — livemode (Y12).** The expectation now comes from `computeExpectedLivemode` (runtime ×
  key prefix), not from `BILLING_PLAN_ENV`, which is a plan-catalogue selector and says nothing about
  which mode the key we hold can act in. Indeterminate ⇒ **503 `MODE_INDETERMINATE`** with no row and
  a `billing.livemode_indeterminate` alert. A mismatch still parks the event terminally, now with a
  rate-limited `billing.livemode_mismatch` alert (one per process per 10 minutes — the fault is
  standing, not per-event), and the parked row is **reclaimable**: once the configuration is
  corrected, Stripe's own redelivery re-claims and processes it. Recovery is a redelivery, never a
  replay tool (INV-A10).

**New, optional `BILLING_DEPLOYMENT_MARKER`.** Unset ⇒ behaviour identical to before the variable
existed. Set ⇒ an absent or different `metadata.luster_deployment` is definitely foreign, with zero
Stripe calls. PR-2 only *honours* it; PR-3 stamps it. The runbook §4 row says, in bold, to set it only
after the stamping deploy.

Billing stays dark: no environment value, no switch, no migration, no CI change, no Stripe or Vercel
change. The real-PostgreSQL refund suite still executes 17 tests with zero skips.

Not done, deliberately: `reconcile/route.ts` is untouched — it only ever projects subscriptions read
out of this database, so the projection's INSERT path (and `SALON_NOT_LOCAL` with it) is unreachable
there, and a non-applied outcome already reports `repaired:false` without throwing. Its suite gained
a test pinning both halves of that claim, including that remote metadata can never re-tenant a local
row.
