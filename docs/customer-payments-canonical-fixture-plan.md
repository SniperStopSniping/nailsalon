# Capture-only canonical fixture application

Status: implemented and verified locally after checkpoint `7f642005`. This is an offline capture rehearsal, not installed Stripe settlement,
payment activation or permission to run external payments. All execution is limited
to injected fake evidence and private disposable test databases.

## Scope and provenance

`createProviderFixtureCaptureApplication(database).applyCapture({ operationId })`
accepts an operation UUID and an explicitly injected database. It recomputes
persisted fixture evidence rather than accepting caller money, status, timestamps,
allocations or a saved matched boolean. No provider client, network transport,
global database or application route belongs in this boundary. The already
persisted result of the closed fake transport is its only operation-result input.

The seventh default-off switch,
`CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED=false`, requires the provider,
preparation and ledger test gates. The provider gate requires `NODE_ENV=test` and
rejects production markers even with switches forced true.

Canonical source is distinctly `offline_fixture_test`. Existing synthetic capture,
refund, fee-return and credit writers remain synthetic-only. Signed fixture events
are never relabeled `synthetic_test` or verified real-provider money.

An immutable application binds operation, quote, complete source and ownership
snapshots/revisions, selected success-event observation, platform/account/charge,
PaymentIntent, capture, reserved tender and final material platform revision. The
historical claim's correlation link does not substitute for a current application
source snapshot. Event time is observed fixture success, not an invented processor
settlement or payout timestamp.

## Atomic application and later holds

One transaction rechecks current source, quote, capability, services, tax, tip,
account, deposit history and lifecycle before writing the application, capture,
tender and paid/tip cache together. Deferred SQL checks reject orphan,
cross-source, mismatched or incomplete bindings at commit. Stable platform,
connected account, test mode and charge identity prevent duplicate application,
independent of event or endpoint IDs. PaymentIntent uniqueness remains an
additional restriction. Unsupported evidence, expired/stale quotes or conflicting
ownership never grant booking credit.

Source ingestion and application share a precreated singleton admission fence.
Writers acquire it NOWAIT and increment its guarded admission revision. A separate
per-platform revision advances only for material source facts. The guarded update
forces old repeatable-read writers to retry their entire transaction. The initial
platform insertion occurs after singleton admission, so it cannot introduce an
unfenced first-use lock wait. Existing correlation mutex acquisition is NOWAIT.
Only rolled-back local database transactions retry; provider dispatch is never
inside that retry callback. The conservative fixture fence can also refuse a
concurrent legacy/synthetic marker mutation. This is a documented local-test
contention cost, not a production throughput design.

SQL source BEFORE triggers acquire admission. AFTER actual inserts and meaningful
updates advance the material revision and append durable holds. An exact
same-endpoint receipt replay that hits ON CONFLICT does not create a hold; version,
lease and harmless inspection changes must not invalidate an application. Canonical
application uses natural relationship discovery and complete platform evidence,
not retained derived inspection links. Adding an unrelated inspection pointer can
change a diagnostic correlation view but cannot alter canonical authority. A new
receipt identity from another endpoint may conservatively hold prior applications
even if payload facts match, but cannot double-post the same charge.

Appointment-first protected mutations acquire admission FOR SHARE NOWAIT and read
the locked current material revision. They compare it with the immutable
application revision rather than relying only on hold rows that might be absent
from an older snapshot. Conflicts abort instead of waiting in reverse lock order.

The first bounded implementation deliberately holds all earlier applications in
the same fixture platform when materially new source facts arrive. This can hold
unrelated appointments and is not a production invalidation or throughput design.
There is no automatic hold-clearing workflow in this phase.

## Readers and authority

Later evidence never voids or erases gross capture/tender facts or rewrites their
original date. Separate fixture provenance and reporting validate the immutable
binding. Reconciliation reads retain gross cash, while a durable hold blocks
collection, completion, lifecycle and unsupported credit paths. No refund or
dispute amount is invented from a status or from the existence of a hold.

Historical fixture reads require preparation/ledger read gates plus strict
`NODE_ENV=test`. They ignore both provider-fixture-write and application-write
switches: disabling future writes cannot erase existing cash or holds. In other
environments fixture rows remain unproven and fail closed. Synthetic reader
semantics are not broadened. Mixed cash reporting partitions sources, verifies
all reserved markers exactly once, and preserves earned-service calculations.

## Explicitly deferred

Refund principal/tip allocation, fee-return policy, legal invoice credits, dispute
posting and restoration after a won dispute remain separate work. Refund, dispute,
unknown or conflicting evidence present before application blocks posting in this
phase. A saved correlation result cannot authorize money movement.

Actual Stripe execution, Apple Pay/card checkout, real accounts, application
migrations, deployment, commercial terms and activation remain outside this local
rehearsal. Fee payer, proposed CA$1 fee scope, tax/refund terms and actual Connect
costs remain unresolved. Customer-paid surcharges stay unsupported/default off.

## Verification boundary

Required checks include exact provenance and binding, full transaction rollback,
replay and cross-owner identities, authoritative quote/source changes, late holds,
write-flag rollback, independent full-journal review and genuine PostgreSQL races.
The native cases must cover ingestion/application, competing applications,
appointment-first mutations, old repeatable-read snapshots and meaningful versus
harmless source updates. Existing synthetic, deposit, tax/tip, refund, credit,
reporting and lifecycle regressions must remain green.

Final verification passed: 1,714 scoped regressions, 54 separate genuine
PostgreSQL cases, 20 mocked desktop/mobile browser cases, standalone typecheck,
scoped lint, a full production build and 12 built-app production-off checks. The
build needed a temporary 6 GiB Node heap; type validation stayed enabled and the
cache-only local configuration change was restored. These are not a full
repository pass, authenticated application journey or real provider certification.
See `customer-payments-integration-gates.md` for the exact checkpoint results.
