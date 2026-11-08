# Customer payment integration gates

Status: default-off, nonproduction draft/quote preparation, plus isolated money
rehearsal. No provider calls, charges, deployment or production activation. Added
migration 0115 has run only in isolated PGlite and a private disposable native
PostgreSQL test cluster, not an application database.
The preparation repository is capable of writing the new policy/receipt/quote
tables when separately enabled on an authorized database; it does not change
existing money. A passing pure/component test does not certify the booking journey.

## Implemented preparation boundary

- `src/libs/customerPayments/preparationGate.ts` gates both new APIs before their
  dynamic DB/auth imports and supplies the owner UI flag through
  `src/app/[locale]/admin/layout.tsx`, `OwnerAdminClientBoundary.tsx` and
  `OwnerAdminFeatureFlags.ts`. It defaults off and rejects production.
- `src/app/api/admin/salon/customer-payments/route.ts` and
  `src/components/customerPayments/CustomerPaymentDraftSettings.tsx` provide a
  separately saved owner-only test draft. `settings.ts` permits only
  `optional_full`/salon-paid fees. Existing tax/e-Transfer/deposit saves are unchanged.
- `src/app/api/public/appointments/manage/[token]/payment-quote/route.ts`,
  `src/libs/customerPayments/server/prepareQuoteForToken.ts` and `quoteMaterial.ts`
  authorize an existing appointment capability, derive frozen CAD full-quote
  amounts, validate source context and return no provider account/URL/token data.
  Input is only request ID and tip cents; the response is explicitly non-executable.
- Only future confirmed, unstarted/unfinalized appointments with supported booked
  items, no existing tip or payment/deposit history, an enabled test draft and a
  single eligible cached test binding are supported. No remaining-balance,
  existing deposit or manual-price payment path is added.
- `migrations/0115_customer_payment_preparation.sql`,
  `src/models/customerPaymentSchema.ts` and
  `src/libs/customerPayments/server/preparationRepository.ts` provide separate
  policy CAS, immutable actor-bound replay receipts and immutable short-lived
  quote records. There is no capture/refund/operation ledger in this migration.
- Focused evidence: new settings/API/editor/layout tests,
  `preparationGate.test.ts`, `quoteMaterial.test.ts`,
  `server/preparationRepository.test.ts`, `server/prepareQuoteForToken.test.ts`
  and the quote route tests. Five `server/preparation.concurrency.integration.test.ts`
  cases also passed against native PostgreSQL 16.15 with four separately attested
  sessions and the real migration journal. This verifies preparation CAS/replay/
  cap/lock ordering, not future financial writers or rollout readiness.

The sections below remain gates for actual collection unless explicitly marked
implemented above. They are not claims that those adapters are installed.

## 1. Authoritative selection and required deposits

- Wire the chooser into `src/app/(unauth)/book/confirm/BookConfirmClient.tsx`
  beside review totals only after collection/settlement is safe. It is not wired
  to the new preparation endpoint yet. Do not reuse the deliberately unavailable
  `src/app/(unauth)/payment-methods/page.tsx`.
- Obtain server-owned prices, tax, discounts and deposit requirements through
  `src/libs/customerAssistant/prepareQuote.server.ts`. The existing
  `src/app/api/public/customer-booking/[salonId]/prepare/route.ts` requires a
  verified handoff; it is not a generic legacy-booking quote endpoint.
- Bind quote, tip, fee-policy version, expiry and money revision to the verified
  tenant/customer operation. Invalidate on selection, policy, invoice or tip
  changes and require fresh customer review. Never charge client-supplied totals.
- Preserve `expectedDepositFingerprint`, booking idempotency/recovery keys,
  changed-deposit review, existing hold expiry and secure deposit resume behavior.
  Salon/network no-show deposits override an optional pay-in-person selection.
  Do not create a second customer-payment attempt for an existing deposit hold.
- Required tests: extend `BookConfirmClient.test.tsx`,
  `src/app/api/appointments/route.deposits.integration.test.ts`,
  `route.deposits.idempotency.integration.test.ts`, and
  `src/libs/customerAssistant/prepareQuote.server.test.ts` with required-deposit
  precedence, changed quotes, legacy/handoff differences and retry races.

## 2. Owner settings and capability boundaries

- `src/components/admin/SettingsModal.tsx` has separate tax/e-Transfer and deposit
  save operations. The new gated test-draft panel is separate and persists only
  into the new policy tables. Do not route its save through deposit activation or
  represent a saved draft as live customer payment settings.
- `src/app/api/admin/salon/settings/route.ts` validates and merges existing payment
  settings and can contact providers during deposit activation. That route is
  unchanged. The new owner-only route uses `settings.ts` and separate CAS/replay
  persistence; it must remain independent of provider readiness activation.
- Customer capability reuse starts at
  `src/app/[locale]/[slug]/manage/[token]/ManageAppointmentView.tsx` and
  `src/app/api/public/appointments/manage/[token]/route.ts`. Verify token expiry,
  revocation and tenant/appointment binding on every money operation.
- `src/app/api/appointments/[id]/checkout/route.ts` is staff/admin-only. Do not
  weaken that guard for customer payment quotes. Awaiting-deposit management stays
  read-only except the existing authorized resume action.
- Required tests: settings payments/deposit tests, manage-token integration tests,
  cross-tenant/revoked/expired capability denial and no secret/checkout-URL leakage
  through status endpoints, logs or referrers.

## 3. Canonical balance, tips and lifecycle

- `src/libs/customerPayments/accounting.ts` is a projection, not a persistence
  adapter. Its revision/generation must become real atomic invariants under the
  same appointment lock as `appointmentPaymentLedger.ts`,
  `appointmentDepositFinancials.ts` and `appointmentTaxSnapshot.ts`.
- Full prepayments are separate from deposit records. Count a captured payment
  once before and after posting into the canonical tender ledger. Unknown invoice,
  currency, manual-price, overpayment or historical-ledger state fails closed.
- No silent tip loss: `src/app/api/appointments/[id]/complete/route.ts` currently
  defaults omitted `payload.tipCents` to zero. Once prepayments exist, completion,
  repricing, rescheduling and reopening must retain already captured tips unless
  an explicit confirmed refund changes them. UI omission is not refund intent.
- Required tests: `src/libs/customerPayments/accounting.test.ts`,
  `src/app/api/appointments/[id]/complete/route.integration.test.ts`,
  `src/app/api/appointments/[id]/reopen/route.test.ts` and ledger/deposit financial
  unit tests. Cover omitted/zero tip, tips on deposits and later balance payments,
  concurrent completion/payment, price reductions and stale invoice generation.

## 4. Refunds do not create a new collection obligation

- A captured provider payment is not an offline bookkeeping error. Before any
  online credit reaches `appointment_payment`, protect
  `src/app/api/appointments/[id]/payments/[paymentId]/void/route.ts` from manually
  voiding it. Only verified refund evidence may reduce provider-backed credit.
- A principal refund on an unchanged invoice must not silently reopen collectible
  balance. Require an explicit invoice adjustment or reconciliation/collection
  hold. Test active and completed appointments as well as cancelled appointments.
- Use explicit principal/tip allocation, unique successful provider refund IDs,
  account/intent/currency/mode binding and atomic receipt plus ledger mutation.
  Pending/failed/uncertain refunds are not money returned. Retries reuse durable
  operation identity and first reconcile an uncertain provider outcome.
- `attempt.ts` fee-refund receipts and `refunds.ts` proportional calculations are
  distinct: a calculated amount due is not proof of a fee refund. Retain and retry
  out-of-order fee evidence without counting it or acknowledging it as applied.
- Required tests: `attempt.test.ts`, `accounting.test.ts`,
  `server/rehearsalStore.test.ts`, plus new void-route provider-origin tests.
  Cover partial/full principal and tip refunds, duplicate/cross-account receipts,
  fee receipt before customer refund, cumulative rounding, post-restart retries,
  and attempted recollection after refund.

## 5. Immutable reporting and audit

- Keep original captured gross principal/tip/fee and each refund as immutable,
  timestamped events. A mutable current net amount is not historical revenue.
- `src/libs/financialReportingServer.ts` currently excludes rows whose
  `voidedAt` is non-null. A void-and-replacement net tender alone would remove the
  original capture from earlier as-of reports. Do not ship that representation as
  the reporting source; add an explicit historical capture/refund projection.
- Required tests: `financialReportingServer.test.ts` and
  `financialReporting.test.ts`: capture in one period, refund in a later period,
  multiple partial refunds, tips, fee refunds and reopened appointments. Re-running
  the earlier report must retain the original capture and never double count.

## 6. Provider execution and UI truthfulness

- `checkout.ts` builds parameters only. The future execution adapter must verify
  actual credentials and connected-account test mode, allowed return origins,
  readiness, durable outbox/idempotency and timeout recovery. A runtime string
  alone does not attest provider mode. Keep collection disabled independently of
  receipt/reconciliation processing.
- `attempt.ts` accepts trusted evidence; it does not verify webhook signatures.
  Verify signature and provider identity before calling it. Browser success URLs,
  supplied event bodies and owner buttons cannot settle money.
- `server/rehearsalStore.ts` is temp-directory PGlite only; it deliberately has no
  application DB or Stripe client. Its unique receipts/transaction tests do not
  certify multi-connection PostgreSQL concurrency or actual provider behavior.
- `CustomerPaymentChooser.tsx` must display the authoritative current quote,
  default to no tip, show due-now/remaining and recipients, suppress repeated
  submissions, preserve unresolved status on refresh and offer safe retry/back.
  Apple Pay remains Stripe/device-dependent; continuing is not payment success.
- Required verification: existing `CustomerPayments.test.tsx` and
  `tests/browser/customerPayments/checkout.spec.ts` plus full Next booking tests,
  disposable PostgreSQL race tests, keyboard/screen-reader checks and separately
  authorized Stripe test-mode card/wallet/refund tests. No live provider test is
  implied or performed by this checklist.

## Current review boundary

The new owner test-draft and capability-authorized quote persistence described
above is implemented. The rest of this checklist records collection requirements,
not proof those integrations exist. Existing booking/payment/deposit mutation
routes remain unchanged; the owner settings UI now mounts a separately gated draft
editor. Production preparation and collection stay blocked. Real ledger readers,
atomic settlement, lifecycle/void protections, immutable reporting, provider
execution and attested PostgreSQL races for the future financial writers remain
required before collection. The preparation-only PostgreSQL races passed.

### Earlier foundation review checkpoint

These review/test results predate the actual preparation slice and are not
evidence of installed settlement or current full-suite/build coverage.

- The initial accounting refund projection could reopen collectible principal on
  an unchanged active invoice. The reviewed revision now requires a validated
  `collectionHold` and sets `refund_reconciliation_required` after refunds; an
  explicit later reconciliation is required before collection can resume.
- Original fee binding and successful fee-refund receipts in `attempt.ts` and the
  isolated store bind account, intent/fee identity, mode, currency and cumulative
  refund amount. Replays are deduplicated and conflicting evidence fails closed.
- Independently reran `attempt.test.ts` and `server/rehearsalStore.test.ts`:
  58 tests passed. This verifies synthetic pure-state/local persistence behavior,
  not webhook authenticity, provider execution, live accounting or PostgreSQL races.
- Existing completion-tip, generic manual-void and as-of reporting integration
  blockers above remain unresolved. No existing application mutation path was
  changed during this review.
- Final-invoice tips are immutable gross amounts: the reviewed accounting revision
  rejects a finalized invoice whose tip is below its captured net tip floor, and
  tip refunds retain the final gross tip while recording refunded tip separately.
  Draft tip preservation is not permission to rewrite finalized invoices.
- Independently reran the corrected `accounting.test.ts`: 14 tests passed,
  including final-tip rejection, retained gross tip after refund and blocked
  recollection after active/completed refunds. Earlier runs during the edit caught
  a stale test expectation; that expectation was corrected before this pass.
