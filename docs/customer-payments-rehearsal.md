# Customer payments: disabled preparation and synthetic settlement

This work starts from v1.150.1 (`7e0801a94ad2ce87e67539648a62c771f3b5040c`).
It is **not an end-to-end real payment setup**. No provider session, card or wallet
operation, real charge, refund, bank connection or production activation is
implemented by this milestone. No migration has been applied to an application
DB and no deployment is included.

## Implemented boundaries

### Owner drafts and authoritative customer previews

- Owner-only GET/PATCH `/api/admin/salon/customer-payments?salonSlug=...` saves a
  separate test draft with revision checks and immutable actor/tenant/request
  replay receipts. Default is off. Only optional full-payment preparation with
  salon-paid fees is supported. Required-full/new required-deposit settings and
  customer-paid fees fail validation. Existing tax/e-Transfer/deposit saves remain
  separate. Draft cancellation text is not published as live customer policy.
- The owner Settings/Payments panel is mounted by a server-derived preparation
  flag. A save is explicitly a draft, never activation or provider onboarding.
- POST `/api/public/appointments/manage/[token]/payment-quote` accepts only a
  request UUID and tip cents. It revalidates the existing capability under the
  appointment lock and derives prices/tax from booked items and frozen snapshots,
  plus the draft policy and server-owned cached test account binding. Cached
  account readiness is not authorization to contact a provider.
- Only future confirmed, unstarted/unfinalized CAD appointments with supported
  fixed/catalog pricing, no existing tip/tender/deposit history, an enabled draft
  and an eligible test binding can prepare quotes. Manual prices, historical
  money ambiguity and required deposits fail closed. Quotes expire within five
  minutes, bounded by capability expiry and appointment start. Replays revalidate
  source context. Responses are test-only, non-executable and collection-disabled.
- `ManageAppointmentView.tsx` now mounts `CustomerPaymentQuotePreview.tsx` under
  that server flag for obviously eligible appointments only. No request runs on
  page load. Customers can prepare a test preview with no tip or a custom tip,
  inspect actual server tax/fee totals and recheck the quote. Uncertain retries
  reuse the request UUID; edited tips, expired quotes and changed source evidence
  require review. Late responses cannot replace a newer choice. There is no Pay,
  checkout, Apple Pay operation or payment-success claim. Existing cards,
  scheduling actions and required-deposit/resume behavior are unchanged.
- Migration `0115_customer_payment_preparation.sql` provides separate policy,
  immutable policy receipt and immutable prepared-quote tables.

### Internal synthetic settlement and real readers

- `server/settleSyntheticCapture.ts` is an injected-DB fixture seam, not a public
  capture API or provider adapter. It requires both preparation and ledger-test
  gates, synthetic test evidence and a known immutable quote.
- Migration `0116_customer_payment_synthetic_capture.sql` adds immutable capture
  and event receipts. Under the appointment/source locks, valid evidence commits
  capture, receipt, a reserved `appointment_payment` marker and tip/cache effects
  atomically. No full payment is disguised as a legacy deposit.
- Late, cancelled, revoked, stale, distinct duplicate or mismatched synthetic
  captures remain captured facts held for review. Their marker does not become
  usable appointment credit or revive the appointment. Retry-required outcomes
  before acceptance must not be acknowledged as settled.
- Provenance readers now feed the actual checkout, manage and financial readers.
  Unknown, unverified or held markers fail closed. Completion preserves the
  prepaid tip when omitted and rejects tip reduction; frozen finalization is
  tested through the actual completion route. Additional in-person tip tender is
  staged atomically and rolls back on any failed finalization. Changed service
  price, tax configuration or exemption returns a reconciliation conflict before
  writes; it is not silently adopted. Verified service start/wrap-up is allowed.
- Migration `0117_customer_payment_mutation_guards.sql` backs up application
  lifecycle guards for indirect appointment, item, tender and new-deposit writes,
  including late held-review money. Captured appointments cannot be cancelled,
  repriced, rescheduled/reassigned, reopened or generically voided until a future
  explicit reconciliation/refund path exists. Safe supported progression and
  frozen finalization remain possible; final tax/tip evidence cannot be rewritten.
  Destructive reset/purge retains reserved money history, fences parent/client
  rows first and returns a retryable conflict on contention without partial deletion.
- Immutable capture-time reporting now counts synthetic gross cash once, includes
  held cash separately, handles currency disclosure and avoids treating held
  money as booking credit. This is capture reporting, **not refund reporting**.
- Ordinary untagged legacy rows do not query the new payment tables. Switching
  flags off does not turn reserved markers into manual tender or remove their
  lifecycle protection. Tagged money becomes unresolved rather than silently
  disappearing from collectible-balance decisions.

### Separate rehearsal and pure foundations

`CustomerPaymentsRehearsal.tsx` remains a synthetic presentation fixture with a
CA$105 service and example 13% tax, not a tax recommendation. Its controlled
chooser demonstrates tips, breakdowns and deposit/full/in-person policies. Those
fixture options do not expand the narrower persisted preparation eligibility.

Pure quote/accounting, Checkout-parameter, attempt and proportional fee-refund
helpers plus the temporary PGlite rehearsal store remain foundations. Synthetic
refund receipts in that isolated store are not an installed application refund
ledger, verified webhook driver or real refund. The proposed CA$1 Luster fee is
configurable and salon-paid here; Stripe processing expense is not invented as
an actual customer charge. Apple Pay would be offered by Stripe only when eligible.

## Three independent default-off controls

- `CUSTOMER_PAYMENTS_REHEARSAL_ENABLED=false`: presentation-only
  `/en/payments-rehearsal`; no persisted salon settings or money.
- `CUSTOMER_PAYMENTS_PREPARATION_ENABLED=false`: owner draft and capability quote
  APIs plus their gated UI. Requires reviewed preparation schema and authorized
  local/disposable fixtures.
- `CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED=false`: internal synthetic capture and
  provenance/reporting fixture integration; also requires preparation enabled.
  Requires the reviewed settlement/guard migrations in disposable infrastructure.

Production is refused. None enables Stripe execution. Do not enable these against
an unreviewed or shared application database. Migrations 0115–0117 have been
exercised through the real journal in isolated fixtures/disposable PostgreSQL,
not applied to a development, preview or production application DB.

The standalone browser harness needs neither application DB nor provider access:

```sh
./node_modules/.bin/playwright test --config tests/browser/customerPayments/playwright.config.ts
```

It binds to loopback. Owner-draft and customer-quote transports are explicitly
mocked. It does not certify the authenticated full Next.js/database journey.

## Current scoped verification (2026-11-08)

- Real-journal persisted quote → synthetic capture → real provenance → checkout
  → completion tests cover zero balance, prepaid tip, frozen added tax, extra
  in-person tip, replay, rollback on failed finalization and typed refusal of
  changed price/tax. Client history/profile readers cover posted and held money.
- Seven immutable capture/reporting integration cases cover event-time gross cash,
  held credit, currency, flag rollback, indirect mutations, service progression
  through actual SQL guards and frozen finalization.
- Genuine PostgreSQL concurrency verification uses separately attested physical
  sessions and the full migration journal on private disposable PostgreSQL 16.15.
  It covers preparation replay/CAS, capture races, source contention, child insert
  races and legacy purge contention. The private cluster and secrets are removed
  afterward; no existing service or application DB is changed. All 16 cases passed
  (11 settlement/purge and five preparation), including the client-first booking
  lock chain against staff reset.
- All 14 standalone Chromium/mobile WebKit browser cases passed. These cover owner
  draft save/reload/conflict/retry, interrupted/repeated quote requests, edited-tip
  stale responses, expiry, source conflicts, mobile width and no external requests.
  This harness mocks HTTP transport; it is not authenticated full-app browser QA.
- Final aggregate: 969 tests passed in 54 files. The 16 opt-in PostgreSQL cases
  were skipped in that run and passed separately as described above. Scoped lint
  passed with one browser-harness Fast Refresh warning. After the final typed
  transaction-handle adjustment, all 24 affected completion tests passed again.
- Node 24 standalone typecheck and full Next.js production build passed. Webpack
  cache was temporarily disabled to fit the local disk budget, then the config
  was restored; type checking was not disabled.
- Six built-app smoke checks returned 404 for owner draft, customer quote and
  rehearsal routes, both default-off and with flags forced true in production.
  Owned app processes were stopped afterward.
- Secret scan passed across 5,566 tracked and 613 generated files. No runtime
  credential, application database, provider call, push or deployment was used.

## Remaining gates before collection

1. Approve fee payer, fee scope, tax, cancellation/refund policy and operational
   responsibilities. Customer-paid surcharges remain unsupported. CA$1 revenue
   is not net profit; actual Stripe/Connect costs and account settings need review.
2. Add recoverable provider operations/outbox and a signature-verified durable
   inbox with account, mode, session, intent, amount, currency and fee binding.
   A redirect is never payment evidence. Recheck actual test-mode credentials and
   account authorization before any separately approved provider execution.
3. Implement application refund and fee-refund ledgers, immutable allocations,
   invoice adjustments/collection holds and reconciliation. Do not reopen a
   collectible invoice merely by refunding principal. Retain original gross
   capture history and add dated refund reporting, disputes and late-event repair.
4. Extend current synthetic reader/settlement/lifecycle proofs to each real
   provider/refund path, with PostgreSQL races, auth/tenant tests, full Next.js
   journeys, receipt/reporting checks, accessibility and full CI/security review.
   Real Stripe test-mode card, wallet and refund execution remains unperformed.
5. Separately authorize migration rollout, deployment and activation after
   onboarding, pricing/legal/tax review, alerts, reconciliation and kill-switch
   behavior are ready. None is part of this milestone.

See `docs/customer-payments-integration-gates.md` for source-level gates and
`src/libs/customerPayments/server/README.md` for disposable test instructions.

## Official Stripe references

- [Direct charges and application fees](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted)
- [Direct-charge fee-payer behavior](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior)
- [Canada payment pricing](https://stripe.com/en-ca/pricing)
- [Canada Connect pricing](https://stripe.com/en-ca/connect/pricing)
- [Payouts and availability](https://docs.stripe.com/payouts)

Verify current pricing and actual account configuration before activation.
