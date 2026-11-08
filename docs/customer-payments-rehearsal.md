# Customer payments: disabled test foundation

This change starts from v1.150.1 (`7e0801a94ad2ce87e67539648a62c771f3b5040c`).
It does **not** enable customer payments, connect a bank account, create Stripe
objects, collect fees, change salon settings, apply a migration, or change the
existing deposit flow. No production release is included.

## Implemented

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

## Try the UI locally

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
   version the policy and immutable invoice/quote snapshots. Design additive
   schema changes and migration/rollback, preserving historical deposits.
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
