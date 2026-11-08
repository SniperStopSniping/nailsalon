# Verified provider adapter: offline journal and remaining boundary

The offline journal described below is implemented for signed fixtures and a
closed fake transport. It is not an installed Stripe adapter or authorization to
run payments. No Stripe account/API operation, credential change,
webhook registration, application migration or deployment was performed.

## Existing code and integration hazard

- `src/libs/customerPayments/checkout.ts` builds direct-charge parameters; it
  does not create a provider session. `attempt.ts` and `refunds.ts` supply local
  lifecycle/math contracts, not verified provider authority.
- `src/app/api/webhooks/stripe-connect/route.ts` verifies raw-body signatures,
  claims an event globally, dispatches deposit/account handling and records one
  terminal outcome. A customer-payment consumer added after that dispatch could
  be skipped after a deposit handler classified the event as terminal.
- That route also performs late-deposit recovery and refund discovery/adoption.
  Those paths can invoke Stripe. Do not import or reuse its dispatch wholesale
  for a no-network customer-payment adapter.
- `src/libs/stripe.ts` pins API version `2024-06-20` and initializes a shared
  credential-backed client. Do not silently change its version, timeout, retries
  or billing behavior while implementing customer payments.

## Inert local slice

The following are design requirements for the eventual provider boundary. The
implemented offline subset and its remaining limits are described afterward.

1. **Verified receipt boundary.** Inject an offline signature verifier and a
   fixed endpoint configuration. Persist authenticated evidence before processing:
   endpoint/platform scope, account scope, actual mode, event/object identifiers,
   API version, payload digest, normalized relevant facts and receipt time.
   Invalid signatures create no financial rows. Authenticated but unmatched money
   remains retained for review; it is not silently acknowledged as no movement.
2. **Independent consumer delivery.** Give each inbox event a separate delivery
   record per consumer/version, with fenced claims and retry state. Deposit,
   customer-payment and fee consumers must not suppress one another. Deduplicate
   both transport events and immutable business movements, including event fanout.
3. **Recoverable operation journal.** Persist operation identity, tenant, immutable
   quote/context, account/mode, exact parameter hash, API version and stable
   idempotency key before dispatch. Checkout creation, customer refunds and fee
   returns are different operations. Inject transport; perform no network work
   while financial database locks are held.
4. **Uncertain outcomes.** A timeout or crash after dispatch is uncertain, not a
   failed payment. Keep the same operation identity and reconcile it before any
   retry. Fence stale workers. Expired provider idempotency retention requires
   reconciliation rather than blindly reusing a key or generating a new one.
5. **Verified relationships.** Validate session/intent/charge, refund/charge,
   application-fee/charge and fee-return/fee relationships. Match currency,
   amount, actual mode, account and original operation. Metadata and cached
   Connect flags alone are insufficient. Distinguish platform fee events from
   connected-account customer events; do not manufacture a missing account field.
6. **Separate provenance.** Do not rename synthetic evidence as verified money.
   Introduce a distinct verified-provider source and adapter. Extend immutable
   settlement/refund/credit protections only after receipt and relationship
   validation. Old redirects, buttons and scalar payment status cannot assert
   payment success.

The implementation lives in `src/libs/customerPayments/provider/`,
`server/providerJournal.ts`, and additive migration 0120. Its dedicated switch
requires `NODE_ENV=test`, preparation enabled and no production deployment marker.
No route or worker is registered, and the global Stripe client is not imported.
Signatures are verified by an injected offline verifier; the durable provenance is
explicitly `offline_signed_fixture`, never real provider authority.

The journal consumers remain under review. A separate explicitly gated
capture-only canonical fixture application is described below; it does not
promote these consumers to real financial authority. A separate consumer can complete an irrelevant-event inspection without
suppressing the relevant consumer. Operation success identifies only a fixture
object. Interrupted dispatch/result persistence requires reconciliation of the
original operation, not a new key. The fake transport is a privately branded
closed response map, not a callback capable of performing arbitrary network work.

Application migrations and all external provider work remain disabled. Read the
adjacent provider README for the precise provenance and authority boundaries.

The original receipt normalizer covers intent, charge, refund, application-fee
and fee-return fixture facts. A separate signed Session supplement and offline
Session-to-intent-to-charge correlation layer now preserve old reviewed receipts
unchanged. Additive migration 0121 deduplicates charge candidates across event and
endpoint IDs and retains contradictory ownership claims. Effective reads rebuild
the complete bounded evidence closure from a consistent snapshot rather than
trusting an old successful graph result.

Additive migration 0122 and `server/providerRefundCorrelation.ts` extend the
offline graph to separately signed customer-refund and application-fee-return
evidence. They bind the exact successful operation result, current parent graph
and scoped business movement ID, preserving independent lifecycle, ownership and
cumulative-limit review. Original review records and financial tables stay intact.

Migration 0123 and `server/providerDisputeCorrelation.ts` add bounded offline
dispute lifecycle and explicit balance-transaction correlation. Status alone does
not imply money movement. Sanitized references preserve malformed/conflicting
transaction discovery; incomplete same-account coverage remains review.

These correlations themselves have no financial authority. Migration 0124 adds a
separate capture-only canonical rehearsal with source `offline_fixture_test`,
fresh complete evidence, atomic binding and durable later-evidence holds. It uses
only already persisted closed-fake-transport results in disposable databases.
See `customer-payments-canonical-fixture-plan.md` for its strict boundaries.
Real-provider verification, canonical real-provider settlement and provider
execution remain unimplemented. Retention or a correlated result cannot replace
those checks.

## Offline Stripe v1 protocol contract

`provider/stripeWebhookFixture.ts` now verifies a strict subset of Stripe's v1
signature format over original bytes, using only `node:crypto` and the existing
test-gated receipt normalizer. The installed Stripe 16.12.0 static helpers generate
headers and verify valid UTF-8 test vectors in tests only. No SDK/client import was
added to the runtime provider graph, and its transitive no-network boundary is
unchanged. The existing routes still use the credential-backed global Stripe
client; none are imported or modified by this slice. The repository's other raw
webhook helper uses the incompatible Standard Webhooks protocol and is not reused.

An explicitly supplied public fixture key, constrained to
`public-offline-stripe-fixture:` plus 1–128 ASCII letters/digits/underscores/hyphens,
is bound to fixed endpoint and platform IDs. Real `whsec_` values cannot enter this
seam. The signed envelope does not choose those IDs. Fixed configuration requires
test mode and API `2024-06-20`; account/mode/version mismatch in authenticated
evidence remains review. Cryptographic validity of a locally generated signature
under a publicly known fixture key is not proof that Stripe delivered an event or
moved money.

This is deliberately a strict protocol profile, not complete Stripe equivalence:

- One canonical safe nonnegative decimal `t`, one or more well-formed lowercase
  SHA-256-hex `v1` values, at most 128 fields and 8,192 header characters. Unknown
  bounded ASCII fields may coexist but cannot authenticate alone. Whitespace,
  duplicate timestamps and malformed components fail.
- At most 300 seconds old and at most 5 seconds ahead of fixed receipt time,
  rounded down to seconds. The future allowance is bounded clock-skew rehearsal;
  SDK 16.12.0 has no future limit. Timestamp suffixes, duplicate `t` and nonnumeric
  timestamps accepted by that SDK are deliberately rejected.
- HMAC authenticates original bytes before decoding. Signed malformed JSON/UTF-8
  and unsupported events remain review receipts. The SDK instead replacement-
  decodes byte payloads and `constructEvent` requires parsable JSON without
  validating the event's structure, account, mode or API version.

Byte/configuration/time/key snapshots and the existing post-await gate check
preserve the fixture boundary. Receipt schema, digest identity and
`offline_signed_fixture` provenance remain unchanged. New signature timestamps on
redelivery do not create new receipt identities or erase financial review holds.
No raw body, header or key is logged or retained. No new migration or financial
writer is introduced. Existing object projections remain deliberately narrow,
including their expanded-reference and lifecycle limitations. Full provider
payload validation, real-provider provenance and production ingress remain future
work requiring the external-testing approvals below.

## Offline cash extension (0125)

A separate immutable fixture movement ledger now consumes freshly revalidated
refund/fee/dispute evidence without provider execution. It requires complete
provenance, unique succeeded operations where applicable, atomic ownership and
exact reconciliation sets. Customer refunds remain unallocated; no legal credit
or hold clearing is implied. Missing dispute balance facts remain unknown even
when lifecycle status is won. This is not live-provider payload compatibility.
See `customer-payments-fixture-movement-plan.md`.

## Provider facts supporting the design

- [Stripe webhook guidance](https://docs.stripe.com/webhooks) requires the original
  request body for signature verification. Deliveries may repeat or arrive out of
  order; separate event objects can also describe the same business object.
- [Stripe signature guidance](https://docs.stripe.com/webhooks/signature) and the
  [Stripe Node 16.12.0 webhook implementation](https://github.com/stripe/stripe-node/blob/v16.12.0/src/Webhooks.ts)
  define the v1 HMAC/test-header contract used by the offline protocol tests.
  The stricter parser and freshness limits above are local fixture choices, not
  claims about the complete provider acceptance contract.
- [Connect webhook scopes](https://docs.stripe.com/connect/webhooks) distinguish
  platform and connected-account events. Connected events identify their account;
  production endpoints can receive both test and live events, so verify mode.
- [API v1 idempotency](https://docs.stripe.com/api/idempotent_requests) replays the
  first executed response, including errors, and keys may be pruned after at least
  24 hours. [Advanced error handling](https://docs.stripe.com/error-low-level)
  explains uncertain network/server outcomes. Do not confuse these v1 semantics
  with the different v2 contract.
- [Direct charges](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted)
  place charge/intent objects on the connected account while application fees
  increase the platform balance. The [fee-refund object](https://docs.stripe.com/api/fee_refunds/object)
  has its own identity and references the application fee it returns.

## Protocol checkpoint verification

The final source passed 1,951 scoped tests in 103 files. The aggregate includes
90 wrapper unit cases and 47 independent protocol/journal cases; those numbers
are not additional totals. Review identified a trailing-line-separator parser
edge case, corrected with complete-match checks and regression tests. Strict
runtime module/network guards were not relaxed. All 60 opt-in PostgreSQL cases
passed separately on a new private PostgreSQL 16.15 cluster, then its data and
ephemeral credentials were removed.

All 20 standalone mock desktop/mobile browser cases, full Node 24 typecheck,
scoped lint and the production build passed. The local build used a temporary
6 GiB process heap and disabled webpack cache; the original configuration was
restored with type validation enabled. All 12 built-app production-off checks
returned 404, including with all eight flags forced on. This is scoped local
validation, not full repository CI or real authenticated/provider testing.

## Still required before external testing

For genuine provider verification, first identify and approve the Stripe sandbox /
platform and connected test salon, the specific permitted operations and limits,
synthetic test data and any endpoint destinations. Existing authorized credentials
must be used through a secure path; creating credentials or persistent access
requires separate approval. Do not request secrets in chat. No sandbox identity
or access path has been verified by this local protocol checkpoint.

Read-only capability inspection and signed test-event verification do not require
final commercial pricing. Before provider-side checkout/refund experiments,
choose explicit synthetic test scenarios and authorize those operations. Before
activation, resolve the fee payer/scope, tax/refund policy, account responsibilities
and actual Stripe/Connect costs. Endpoint registration/configuration, application
migrations, deployment, live payments and real refunds remain separately gated.

The current credit-review workflow resolves only clean completed synthetic
invoices for credit-aware read paths. Ordinary collection/lifecycle actions,
unfinalized or held money, generic receipt/spend readers and real provider handling
still require explicit integration. Synthetic credit allocations are not legal
tax credit notes.
