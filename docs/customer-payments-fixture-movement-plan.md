# Offline fixture movement ledger (0125)

Status: validated local offline checkpoint after `ff170086`. This phase records
observed fixture cash without executing a provider operation or allocating booking
credit. No application database migration, payment, refund, deployment or activation
is included.

## Separate authority and complete batches

`reconcileMovements({ captureApplicationId })` uses an injected database and only
the immutable canonical capture-application ID. It accepts no caller amount,
allocation, timestamp, success flag or financial parent relationship. The new
`CUSTOMER_PAYMENTS_FIXTURE_MOVEMENTS_ENABLED` gate defaults false and depends on
the existing strict fixture application/provider/preparation/ledger test gates.

The canonical loader recomputes the complete bounded natural graph. Retained
inspection pointers never supply financial authority. Recognized refund and
dispute families are validated independently against the same capture parent;
unknown or contradictory evidence cannot be dropped to force a match. Successful
customer or application-fee refunds require uniquely matching succeeded persisted
fixture operations. Unmatched success, missing or uncertain operation evidence,
pending/failed outcomes, missing supplements and overflow prevent a complete new
posting batch. No operation identity is manufactured.

An otherwise clean graph without movement evidence may produce a complete zero-
movement reconciliation. A disputed graph with missing balance evidence remains
incomplete, including won/closed observations with empty transaction arrays.
Neither lifecycle status nor absence of expanded money is proof of restored cash.

## Immutable cash, not invoice allocation

Dedicated `offline_fixture_test` movement rows record:

- Successful customer refund cash, explicitly unallocated.
- Independently proven application-fee returns, bounded by the original fee.
- Explicit dispute withdrawals and reinstatements from signed expanded balance
  transactions, with principal, signed fee and net kept distinct.

These rows never enter synthetic refund/credit writers. Customer refund amounts
are not split into invented principal, tip or tax amounts. Fee-return observation
is independent of the proposed proportional refund policy. Dispute net satisfies
amount minus fee and is not a payout or available-balance estimate.

Original capture/tender gross amounts, paid/tip caches, invoices, tax, earned
service totals and credit decisions remain unchanged. Existing collection and
lifecycle holds are permanent in this phase, including after full refund or won
dispute. An expired quote or revoked booking capability does not erase already
observed historical cash.

## Identity, provenance and atomicity

Natural movement identity includes platform, account scope, null-safe account key,
test mode and provider movement ID. Customer refunds and fee returns are separate
kinds. Dispute balance identity excludes withdrawal/reinstatement category, parent,
operation, event and endpoint, so changing any of those cannot create a second
movement from the same transaction.

Refund success time is an observed event time, not processor settlement time.
Existing rows retain their original selected success witness/reporting date when
new corroborating events arrive. Dispute occurrence uses the immutable balance-
transaction creation time, not availability or lifecycle observation time.

The existing admission-first NOWAIT/guarded-revision fence is reused. Historical
capture bindings and current charge/movement ownership are verified separately;
the old capture revision is expected to be stale after new source facts. It is
not necessary or permissible to clear its hold to retain new cash.

All reservations, new movement rows and the complete reconciliation snapshot commit
together. The immutable snapshot binds exact source/ownership evidence, the whole
existing-plus-new movement set and final material platform revision. Failures after
reservation roll back the entire transaction, not only the financial inserts.
Ledger/snapshot rows are derived outputs and do not themselves change source
revisions. Deferred SQL checks reject malformed, foreign, partial, duplicated or
mismatched bindings; historical rows cannot be edited or deleted.

A later contradiction or source revision preserves earlier recorded cash and
makes reconciliation stale. No previous amount is erased, reversed or reassigned
merely because a newer observation disagrees.

## Reporting and concurrent arrivals

Historical fixture reads require strict test mode plus preparation/ledger read
gates. Future-write switches may be disabled without erasing history. Legacy
salons without reserved markers do not read the new tables.

Refund/dispute periods are independent of capture dates, so original captures are
loaded even when outside the requested reporting window. Customer net cash keeps
its existing meaning: gross captured cash minus customer refunds only. Platform
fee returns, dispute withdrawals/reinstatements and signed dispute fees/net are
reported separately. Unallocated refunded cash is explicit and does not restore
booking credit.

A complete current reconciliation requires an exact movement set and current
source revision. Readers retry a changing read a bounded number of times. If it
still changes, they may retain individually proven historical cash but must omit
current completeness authority, flag reconciliation required and omit net cash.
Missing or mismatched historical birth-batch evidence is a hard failure, not a
concurrency exception. Missing net is never converted to zero.

## Verification and remaining limits

Final integrated verification passed:

- 1,834 scoped regressions across 101 files. The 60 opt-in native PostgreSQL
  cases were skipped in that aggregate and passed separately in all ten files.
  This is not a run of the entire repository test suite.
- 35 independent full-journal boundary cases are included in the aggregate.
  They cover mixed batches, unallocated cash, duplicate/missing operations,
  contradictory source, retained history, rollback after late ownership changes,
  missing balance evidence and explicit reinstatement with signed fee return.
- All 60 genuine PostgreSQL 16.15 cases passed again on final source, including
  six new movement cases. Tests use physical-session attestation, a newly created
  loopback-only SCRAM cluster and the unchanged target/free-disk guards. Known
  `55P03` contention is retried only after original calls finish; business errors
  are not retried. Private infrastructure and ephemeral credentials were removed.
- All 20 standalone desktop/mobile browser cases passed with mocked transport.
  Full Node 24 typecheck and scoped lint passed. Fixture type errors found by the
  initial typecheck were corrected and the final aggregate rerun passed.
- The full production build passed with type validation enabled. It used a
  temporary 6 GiB Node heap and disabled webpack cache for the local build only;
  original configuration was restored. No check was bypassed.
- All 12 built-app production-off checks returned 404 with default flags and
  with all eight flags forced true in production. Direct-helper gating remains
  separately covered. No new public route or provider worker was registered.

The disk blocker was resolved by removing only verified inactive generated build
outputs from older worktrees, under the user's cleanup authorization. Source and
uncommitted work were preserved; validation was serialized. No application DB
migration, provider call, push, deployment or spending occurred.

Real Stripe execution, authenticated application journeys, actual card/Apple Pay
checkout, unmatched provider ingestion, allocation policy, legal tax credits,
ordinary hold restoration, rollout and activation remain separate work. The
proposed fee scope/payer, tax/refund terms and actual Stripe/Connect costs remain
unresolved. This ledger does not establish live-provider payload compatibility.
