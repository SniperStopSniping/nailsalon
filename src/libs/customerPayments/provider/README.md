# Offline provider journal fixtures

This directory is an inert rehearsal of a future provider boundary. It is not a
Stripe integration. Nothing here is mounted as a route, webhook consumer or
scheduled worker, and no operation result can credit or refund appointment money.

`CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED=true` and the preparation switch are
required with `NODE_ENV=test`. Production application/deployment markers also
refuse the gate. Development and production application builds cannot run this
fixture seam even when the switch is set. No credentials are read.

## Evidence and provenance

The receipt verifier authenticates the original bytes through an explicitly
injected offline signature check. It parses those same bytes, keeps only bounded
identity and monetary facts, and records a digest instead of raw customer data.
An invalid signature yields no receipt. Authenticated malformed, unmatched,
unsupported or scope-mismatched evidence remains a review receipt.

Receipt provenance is `offline_signed_fixture`. Runtime branding prevents casts
and JSON deserialization from creating authenticated receipt inputs. This proves
only the injected fixture check, not that Stripe moved money. The provenance is
distinct from the existing `synthetic_test` financial ledger and is never
converted into that ledger's inputs.

Inbox event identity and each consumer/version's delivery are separate. A deposit
consumer's terminal result therefore cannot suppress another consumer. Conflicting
evidence remains retained and blocks trusted completion. Consumer completion is
processing history, never payment success.

## Outbox and uncertain results

Operations persist the tenant, appointment, immutable quote context, account scope,
API version, exact parameter hash and one stable idempotency key. Customer refunds
and application-fee returns are distinct operations. A successful checkout-create
fixture identifies a session, not a successful charge.

The only transport is a privately branded, closed fixture response map. It accepts
no injected network callback. Dispatching is saved before invoking that transport,
outside database transactions. Leases and versions fence stale workers and their
results. A missing response or interrupted result write cannot justify a new
operation or a blind resend.

Reconciliation requires a fresh claim and an observation bound to the original
operation. An explicitly absent fixture result can requeue only inside the
original conservative idempotency window. Expiry or unresolved evidence requires
review. The window never resets on a retry.

## Offline Session correlation and charge deduplication

`sessionEvidence.ts` adds a separately verified Session projection tied to the
original receipt object and exact payload digest. It does not change the old
normalizer, receipt fingerprint, review classification or consumer holds. Original
receipt and supplemental arrival times are retained separately; later redelivery
cannot erase an original timing error. Quote references are UUIDs and no metadata,
customer details, signatures or raw payloads are stored in the supplement.

`correlation.ts` anchors Session identity to the successful persisted operation's
result, then checks reciprocal Session, intent and charge relationships against
the immutable quote. It validates account, platform, mode, API version, requested
and captured amounts, currency and fee evidence. Metadata or a matching quote
reference alone is insufficient. Valid unpaid-to-paid asynchronous evidence is
distinguished from contradictory paid-to-unpaid, expired or failed evidence.
Missing supporting events remain pending; malformed relationships and contradictory
or ambiguous money are review.

`server/providerCorrelation.ts` and migration 0121 retain immutable supporting
links, projections, versioned snapshots and charge claims. The candidate key is
platform, connected account, test mode and charge ID, never event or endpoint ID.
Replays and cross-endpoint delivery cannot create a second candidate. Competing
operation claims remain retained and make both effective results review.

Effective reads rediscover the bounded relationship closure, including conflicting
payload relationships and later refunds. Caller-supplied IDs cannot hide new
contradictions. Evidence overflow fails to review instead of silently truncating
into a successful result. The reader recomputes the graph and charge ownership;
a stored correlated snapshot alone is not authority.

Transactions use repeatable-read snapshots. A fixture-only singleton revision
serializes graph writes and forces stale waiting writers to retry the whole local
transaction. This does not lock future inbox ingestion. Results expose snapshot
start, evaluation time and evidence revisions; a later read sees later arrivals.
The graph remains bounded offline infrastructure, not a scalable production queue.

Every result has `financialPostingAllowed: false`. Correlation never posts tender,
returns money, changes a tax invoice, clears existing collection holds or promotes
fixture provenance to verified real-provider authority.

## Offline customer refund and application-fee return correlation

`refundEvidence.ts` binds a separately signed supplement to the exact original
receipt and payload digest. Only `refund.created`, `refund.updated`, `refund.failed`
and `application_fee.refund.updated` are supported. Original normalization and
review remain unchanged. Customer status is preserved; platform fee returns use
`fee_return_observed` with no fabricated refund status or connected account.
Object occurrence time is distinct from event and receipt arrival times.

`refundCorrelation.ts` freshly recomputes the parent graph after partitioning
only the supported, validated movement evidence. It never trusts an old correlated
snapshot or filters unknown aggregates/capture contradictions. The original
capture reader remains held by refund evidence. Full parent fee proof is required
in this bounded slice, even for a customer refund.

The requested refund operation must bind its exact successful provider object
result and immutable parent/quote context. Earlier pending then later succeeded
can correlate; terminal failures, canceled/action-required refunds and later or
same-time pending contradictions remain review. Refunds may occur after quote
expiry but cannot precede proven capture or fee creation. Fee return observations
never imply customer money returned, or vice versa.

Migration 0122 and `server/providerRefundCorrelation.ts` preserve supporting links,
versioned snapshots and scoped movement claims. Business identity is platform,
account scope, test mode, kind and `re_`/`fr_` ID, not event, endpoint or parent ID.
Conflicting parents or operation ownership remain retained review. Complete
bounded discovery includes unclaimed related money, conflicts and current claims.
Distinct customer and fee amounts have independent parent caps; incomplete totals
are null. Completed totals are diagnostic, never financial accounting.

The shared fixture mutex and repeatable-read retry protocol remain in force.
Effective reads expose snapshot/evaluation times and recompute current evidence.
Original reviews, consumer holds, canonical financial tables and collection rules
are unchanged. Every result has `financialPostingAllowed: false`.

## Offline dispute lifecycle and balance transactions

`disputeEvidence.ts` adds exact-pair signed supplements for dispute created,
updated, closed, funds-withdrawn and funds-reinstated events. Lifecycle status
never manufactures a transaction. Expanded balance details have distinct scoped
`txn_` identities and preserve signed principal, fee and net amounts. Availability
is retained separately from occurrence and immutable money identity.

Malformed money retains sanitized transaction/source references for graph
discovery; incomplete or overflowing coverage is explicit, never silently treated
as empty. `server/providerDisputeCorrelation.ts` accepts a supplement only against
its exact original receipt or retained conflict fingerprint. Uniqueness includes
that receipt anchor. Originals and conflicting payloads remain immutable.

The new loader recomputes bounded supplemental relationships, including
cross-parent transaction reuse before another claim is recorded. Missing or
incomplete same-account dispute projections conservatively require review because
unknown embedded transactions cannot be ruled out. Existing capture/refund
readers keep their prior behavior; the new dispute view never clears their holds.

`disputeCorrelation.ts` supports one dispute per parent, independently tracks
lifecycle, and bounds explicit withdrawals/reinstatements chronologically.
Same-second opposing movements remain ambiguous. Inquiry, closed or won status
is never customer credit or proof of reinstatement. Narrow CAD/no-FX/type/category
contracts are offline fixtures, not tested live-provider compatibility.

Migration 0123 stores append-only projection, support, snapshot, dispute-claim and
balance-claim records. Transaction keys exclude dispute IDs; lifecycle and
availability updates do not create new money identities. No financial rows or
original reviews are changed. Every result has `financialPostingAllowed: false`.

## Deliberately missing authority

There is no real Stripe client, live/test API call, endpoint registration,
financial posting, customer refund, fee return, credential configuration or
deployment. No synthetic result is a legal tax credit note or real payment proof.
Future integration must verify real provider/account relationships, authorization,
current quote and refund limits, canonical settlement, tax/fee policies and
rollout controls before these patterns can be used with external services.

See `docs/customer-payments-provider-adapter-plan.md` for the existing webhook
hazard, verified Stripe documentation and prerequisites for external testing.
