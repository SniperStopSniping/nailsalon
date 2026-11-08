# Planned capture-only canonical fixture application

Status: design for the next local phase after offline dispute correlation. This
is not implemented provider settlement, payment activation or permission to run
external payments. Existing correlation results remain non-financial evidence.

## Scope and provenance

Add a default-off, server-only application entry accepting an operation UUID and
an explicitly injected test database. It must recompute persisted fixture evidence,
not accept caller-provided money, status, allocations or a saved matched boolean.
No provider client, network transport, global database or application route belongs
in this boundary. Production must reject it even with flags forced true.

Use distinct canonical source `offline_fixture_test`. Existing synthetic capture,
refund, fee-return and credit writers remain synthetic-only. Do not relabel signed
fixture events as `synthetic_test` or verified real-provider money.

An immutable application binding connects operation, quote, complete evidence and
ownership revisions, selected success-event observation, platform/account/charge,
PaymentIntent, canonical capture and reserved tender. A successful event timestamp
is observed fixture success, not an invented processor settlement timestamp.

## Atomic application and later holds

One transaction must recheck current source/quote/capability/lifecycle, then write
application, capture, tender and scalar projection together. Deferred SQL checks
must reject orphan, cross-source, mismatched or incomplete bindings at commit.
Stable charge identity, rather than event ID, prevents duplicate application.

A separate source fence must cover ingestion, conflicting evidence, projections,
material operation changes and ownership. Application and existing appointment-
first mutation paths need a proved NOWAIT/whole-transaction retry protocol; no new
path may wait while holding a lock in the reverse order.

Materially new evidence after application appends a hold in the source transaction.
It never erases or voids already recorded gross cash. Identical deliveries and
harmless consumer inspection must not invalidate applications. Readers must retain
cash evidence while collection, completion and unsupported lifecycle/credit paths
fail closed.

The first bounded implementation may conservatively hold every existing application
in the fixture platform when materially new source facts arrive. This deliberately
over-holds unrelated appointments and is not a production invalidation design.
There is no automatic hold-clearing workflow in this phase.

## Explicitly deferred

Refund principal/tip allocation, fee-return policy, legal invoice credits, dispute
posting and automatic restoration after a won dispute remain separate work. Refund
or dispute evidence present before application blocks capture posting in this
phase. Actual Stripe execution, real accounts, application migrations, deployment,
commercial terms and activation are outside this local rehearsal.

## Required verification

- Distinct provenance requires its exact immutable application binding.
- Partial writes, replay, cross-owner identity and quote/source changes fail safely.
- Genuine PostgreSQL races cover ingestion/application, competing applications,
  appointment-first mutations, and later conflicts versus completion/collection.
- Later evidence preserves gross amounts while holding collectibility.
- Disabling the application switch never removes existing cash evidence or holds.
- Existing synthetic, tax/tip, refund, credit, reporting, lifecycle and production-
  off checks remain green, using only fresh private disposable databases.
