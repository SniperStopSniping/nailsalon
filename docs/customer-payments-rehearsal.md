# Customer payments: disabled draft and quote preparation

This change starts from v1.150.1 (`7e0801a94ad2ce87e67539648a62c771f3b5040c`).
It does **not** enable customer payments, connect a bank account, create Stripe
objects, collect fees, mutate existing invoice/tender/deposit money, or change the
existing deposit flow. It now includes separately gated persistence of owner test
drafts and immutable non-executable quotes. Migration 0115 was added and exercised
only in in-memory fixtures; it has not been applied to a development, preview or
production application database. No production release is included.

## Implemented

### Actual bounded preparation slice

- Owner-only GET/PATCH `/api/admin/salon/customer-payments?salonSlug=...`
  persists a separate test draft and immutable request receipt. Absent policy is
  disabled. Only optional full-payment preparation with salon-paid fees is
  supported; required-full/new required-deposit settings and customer-paid fees
  fail validation. Existing salon tax, e-Transfer and deposit settings are untouched.
- `CUSTOMER_PAYMENTS_PREPARATION_ENABLED` defaults off. A server-derived flag
  exposes the separate draft editor in existing owner Settings/Payments. Save is
  explicitly a test draft, not activation or published cancellation terms.
  Owner/tenant authorization, same-origin writes, revision checks and replay
  receipts prevent an ambiguous retry from becoming another update.
- POST `/api/public/appointments/manage/[token]/payment-quote` uses an existing
  appointment capability, revalidated under the appointment lock. The request
  accepts only a UUID request ID and optional-tip amount, not prices, tax, tenant
  or account. Sources are booked item and frozen tax snapshots, draft policy and
  the existing server-owned test account binding. Raw tokens/account IDs/provider
  URLs are not returned.
- Preparation supports only a future, confirmed, not-started, non-finalized CAD
  appointment at an active published salon with fixed/catalog-priced items, no
  existing tip, no tender/deposit history and a single eligible cached test
  account binding. Unsupported or ambiguous money/manual-price/deposit cases
  fail closed rather than attempting a remaining-balance or deposit payment.
  Cached account readiness is not verified provider authorization.
- Quotes expire within five minutes, bounded by capability expiry and appointment
  start. Replays revalidate authoritative source context and reject changes.
  Responses and storage explicitly state test-only/non-executable and collection
  disabled. There is no customer checkout button wired to this endpoint.
- `migrations/0115_customer_payment_preparation.sql` and
  `src/models/customerPaymentSchema.ts` define separate policy, immutable policy
  receipt and immutable prepared-quote tables. The repository is
  `src/libs/customerPayments/server/preparationRepository.ts`. The migration
  adds no provider operation, capture/refund ledger or settlement adapter.

### Isolated UI and pure money foundations

- Controlled salon settings and customer checkout components with optional full
  payment, required deposit, required full payment, or pay in person where allowed.
- Optional tip with no preselected amount, an accessible tax/fee breakdown, an
  explicit remaining balance, and salon cancellation-policy text. Hosted Stripe
  Checkout would offer Apple Pay only when eligible; this fixture does not test
  Apple Pay or collect card details.
- Integer-cent, immutable CAD quote snapshots. The proposed Luster fee defaults
  to CA$1 per online transaction, configurable in the test policy. Offline payment
  has no application fee. The test fixture supports salon-paid fees only.
- A pure direct-charge Checkout parameter builder, with test/nonproduction guards,
  stable idempotency parameters and the Luster application fee separate from
  Stripe's processing expense. It has no Stripe client or execution adapter.
- Cumulative proportional application-fee refund calculations, including full
  reversal after a full customer refund. These are refund plans, not proof of a
  completed fee refund. Separate confirmed fee-refund receipts bind the original
  fee, account and currency and track actual completed amounts independently.
- A pure attempt state machine for immutable evidence, replay, revision checks,
  late payment recovery and historical captured/refunded amounts. Review holds
  never erase money already verified as captured.
- A disk-backed, isolated PGlite rehearsal store for synthetic attempt, event and
  refund receipts. It cannot use an application database or provider connection.
- Pure accounting projections using the existing canonical tax, tender and
  deposit resolvers: stale-quote rejection, separate prepayment credits, tip
  preservation, explicit final-invoice application and refund collection holds.
  These projections are not installed in existing booking or reporting routes.

## Separate gates and local verification

The presentation-only rehearsal remains independent of persisted preparation.
Use the repository's safe local development setup with synthetic/test credentials
and local/disposable infrastructure. Set `CUSTOMER_PAYMENTS_REHEARSAL_ENABLED=true`
in that local environment and visit `/en/payments-rehearsal`. It returns 404 by
default and refuses Production even if enabled. Settings last only for the page;
the example CA$105 service and 13% tax are synthetic and not a tax recommendation.

The standalone browser harness needs no provider credentials or application DB:

```sh
./node_modules/.bin/playwright test --config tests/browser/customerPayments/playwright.config.ts
```

It binds to loopback, tests Chromium and mobile WebKit, and does not send provider
requests. This is a component rehearsal, not proof of the full Next.js booking
journey or a real wallet transaction.

The new preparation gate is not needed by that synthetic harness. Its owner panel
and quote API require the preparation schema and authorized local/disposable
application fixtures; do not enable them against an unreviewed database. A test
draft save changes only the new policy/receipt tables, and quote preparation
changes only the new quote table. No migration outside in-memory fixtures was
performed as part of this slice. Neither flag enables a provider call.

## Financial decisions still open

- Final fee scope: whether a deposit and later balance are separately charged the
  flat fee, minimum amounts, and any exceptions. The current fixture models one
  fee per successful online charge, not one fee per appointment.
- Who pays the fee and applicable tax treatment. Customer-paid fees are rejected;
  no universal card surcharge or processing-fee pass-through is implemented.
- Salon cancellation/refund rules and applicable consumer requirements. Policy
  text is not a blanket restriction on legal refund or dispute rights.
- Actual Stripe account configuration, regional/card fees, application-fee tax,
  Connect costs, payout timing and bank setup. Source code is not evidence of the
  live account's settings, and the Luster fee is revenue, not net profit.

## Required phases before collection

1. **Review policy and data model.** Approve fee payer, tax and refund treatment;
   version the policy and immutable invoice/quote snapshots. Review the added preparation migration and its rollout/rollback separately.
   Design the still-missing money ledger and settlement schema without changing
   historical deposits.
2. **Integrate authoritative booking accounting.** Authorize through appointment
   capabilities and server-owned salon binding. Lock and reconcile the existing
   tender/deposit ledger, prices, tax, discounts and remaining balance. Record
   prepayments and tips exactly once and preserve them on final invoicing,
   cancellation, reschedule, completion and reopen. Never store full payment as
   an old deposit or count it twice.
3. **Add test-only provider execution.** Independently verify client/account mode,
   use a durable operation/outbox and stable idempotency key, then store provider
   results. A return URL must never mark a payment paid. Keep collection disabled
   independently of webhook receipt/reconciliation processing.
4. **Settle and refund safely.** Verify signature, account, mode, session, intent,
   amount, currency and fee. Commit event receipt, tender and invoice effects
   atomically. Install the successful application-fee refund receipt contract and
   durable refund operation states; a repeated “amount due” is not a new refund
   instruction.
   Handle disputes, partial/full refunds, retries and late success with audit and
   reconciliation, retaining historical captured money during review.
5. **Verify and review.** Run attested disposable PostgreSQL multi-connection races,
   complete booking lifecycle and auth/tenant tests, real Stripe test-mode card
   and eligible Apple Pay checks, refund/dispute/retry tests, accessibility,
   reporting/receipt checks, full CI, and security review. PGlite's serialized
   connection does not certify production concurrency.
6. **Separately approve rollout.** Verify actual Connect pricing, salon onboarding,
   legal/tax policy, operational alerts, reconciliation, pilot selection and
   kill-switch behavior. Deployment, migration and enabling live payment/fee
   collection require their own authorized delivery step. No such step is part
   of this local change.

See `docs/customer-payments-integration-gates.md` for the exact affected booking,
checkout and reporting files, `src/libs/customerPayments/server/README.md` for the
isolated-store boundary, and `src/libs/customerPayments/` for contracts and tests.

## Official Stripe references

- [Direct charges and application fees](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted)
- [Direct-charge fee-payer behavior](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior)
- [Canada payment pricing](https://stripe.com/en-ca/pricing)
- [Canada Connect pricing](https://stripe.com/en-ca/connect/pricing)
- [Payouts and availability](https://docs.stripe.com/payouts)

Verify current pricing and the actual account configuration before activation.

## Earlier foundation checkpoint: 2026-11-08

The following results predate the persisted draft/quote slice. They do not attest
a build or end-to-end test of the new preparation API and migration.

- 319 focused tests passed on Node 24: new payment/accounting/rehearsal tests,
  tenant routing, and eight existing deposit/tender regression suites.
- The standalone Chromium and mobile WebKit browser tests passed, including
  no-tip default, fee disclosure, required-deposit selection, back navigation,
  mobile width and no external requests.
- The built Next.js page passed a local Chromium smoke test on Node 24 with
  synthetic credentials: opt-in, online selection, tip, total and continuation.
  No browser exceptions or external requests occurred. The default-off page
  returned HTTP 404.
- Scoped ESLint, `npm run check-types`, and source/commit/client-bundle secret
  scanning passed.
- Full builds passed on Node 22 and Node 24. The ordinary Node 24 build first
  exhausted local disk capacity. Its retry passed with Webpack's filesystem cache
  disabled for that invocation only; the configuration was restored afterward.
  No deployment, provider request, application migration or charge was performed.

Not verified or complete: the full existing test suite and CI, PostgreSQL
multi-connection races, real Stripe test-mode sessions/wallets/refunds, installed
booking/collection/canonical-ledger/reporting adapters, and live account/pricing/tax
readiness. Owner test-draft settings persistence is now implemented separately. Local Docker reported it could not start, so the required attested
disposable PostgreSQL target was not available for this checkpoint.

This is a passing disabled foundation, **not** end-to-end customer payments ready
to enable. Continue the implementation gates above before collection.

## Bounded preparation verification (2026-11-08)

- 446 focused tests passed on Node 24 across preparation, presentation, API,
  owner settings, tenant/tax behavior and eight existing deposit/tender suites.
  The actual appointment service has 13 migration-backed cases, including
  revocation/expiry between initial capability lookup and transaction, stale
  replay, live-account rejection, historical tenant anomalies and unchanged
  appointment/tender/deposit state.
- Six Chromium/mobile WebKit cases passed for the owner draft editor with an
  explicitly mocked API: save/reload, stale revision recovery and identical-request
  retry after a lost response. They verify mobile width and no external requests.
  This is not evidence of a real authenticated browser/database journey. The
  first cold Vite load exceeded 30 seconds; this new test suite uses 90 seconds.
- Migration 0115 was exercised through the full journal in isolated PGlite fixtures
  and a newly created private native PostgreSQL 16.15 test cluster. No application
  database was migrated.
- Five genuine PostgreSQL concurrency cases passed using four separately attested
  physical connections: competing policy CAS, identical policy replay, quote replay,
  the 49-to-50 quote limit and policy/quote lock ordering. Missing-target skip and
  required-target failure guards also passed. See `server/README.md` for the gate.
- Docker could not start because disk was full. The existing native PostgreSQL
  binaries were found under `/opt/homebrew/bin`, so no installation was needed.
  The new loopback-only cluster, synthetic password and temporary data were stopped
  and removed after testing. Existing clusters/services and external databases were
  not touched.
- Scoped lint has no errors (two pre-existing SettingsModal fast-refresh warnings).
- The full Node 24 build, including Next's type check, passed. Webpack's disk cache
  was disabled only for this invocation because the Mac has limited free space;
  the configuration was restored. Both new routes returned default-off HTTP 404
  with no-store headers when exercised against the built local application.
- The source and generated-client secret scan passed. No provider request,
  application migration, charge, push, deployment or production activation ran.

The result is actual bounded preparation code, **not an end-to-end payment setup**.
Real balance readers, provider operations, receipts, atomic settlement, refunds,
reporting and lifecycle protections remain gates before any collection.
