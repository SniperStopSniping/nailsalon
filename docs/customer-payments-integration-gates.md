# Customer payment integration gates

Status: default-off nonproduction preparation plus **internal synthetic** capture,
canonical-reader, lifecycle and reporting integration. No provider collection,
real refunds, deployment or production activation. Migrations 0115–0117 exist in
source and have run through the real journal in isolated/disposable tests only,
not an application DB. The remaining gates below are not implemented payment flows.

## Implemented: preparation and customer context

- `src/libs/customerPayments/preparationGate.ts` rejects production and gates APIs
  before dynamic DB/auth imports. The flag reaches owner settings through
  `src/app/[locale]/admin/layout.tsx`, `OwnerAdminClientBoundary.tsx` and
  `OwnerAdminFeatureFlags.ts`; absent means no draft panel/fetch.
- `src/app/api/admin/salon/customer-payments/route.ts`, `settings.ts` and
  `CustomerPaymentDraftSettings.tsx` provide owner/tenant-authorized test drafts,
  same-origin writes and CAS/replay. `server/preparationRepository.ts` and
  migration `0115_customer_payment_preparation.sql` persist separate policy,
  immutable request receipts and short-lived non-executable quotes. Existing
  `SettingsModal.tsx` tax/e-Transfer/deposit saves remain separate.
- `src/app/api/public/appointments/manage/[token]/payment-quote/route.ts`,
  `server/prepareQuoteForToken.ts` and `quoteMaterial.ts` revalidate capability and
  current locked sources. Input is request UUID and tip only. No provider URL,
  account identifier or raw capability is exposed in the response. Required
  deposits, existing money, manual pricing and ambiguous history fail closed.
- `src/app/[locale]/[slug]/manage/[token]/ManageAppointmentView.tsx` mounts
  `src/components/customerPayments/CustomerPaymentQuotePreview.tsx` under the
  server flag only for obviously eligible appointments. Server API remains the
  authority. No load-time quote request, live payment selection or checkout is
  introduced. No-tip/custom-tip preview, actual breakdown, expiry, source-change
  review, stable uncertain retries and stale-response/unmount guards are covered.
- Evidence: settings/API/editor/layout tests; preparation repository/material/API
  tests; `CustomerPaymentQuotePreview.test.tsx` plus manage `page.test.tsx` (51
  passing); `tests/browser/customerPayments/quote-preview.spec.ts` (six passing
  Chromium/mobile WebKit cases). Browser API transport is mocked, not proof of
  real authenticated application DB operation.

## Implemented: bounded synthetic settlement and canonical readers

- `server/settleSyntheticCapture.ts` is an injected internal fixture seam, not a
  route. `ledgerTestGate.ts` requires both explicit ledger-test and preparation
  flags in nonproduction. Migration `0116_customer_payment_synthetic_capture.sql`
  stores immutable captures and event receipts, unique account/mode/intent and
  reserved canonical tender markers. Receipt, capture, tender and permitted
  tip/cache effects commit atomically under locked authoritative sources.
- Late/stale/revoked/cancelled, distinct duplicate or mismatched captures are
  retained as held facts without usable credit or appointment revival. Pre-accept
  retry-required outcomes are not acknowledged as accepted money. A future inbox
  must retain external evidence independently of this settlement transaction.
- `provenance.ts`, `server/provenanceReader.ts`,
  `src/libs/appointmentCheckoutServer.ts` and `appointmentPaymentLedger.ts` verify
  reserved tender against immutable capture evidence. Actual checkout/manage and
  financial readers use that evidence rather than treating markers as manual
  payments. Ordinary untagged rows never read a new payment table; disabled or
  unknown markers fail closed. Flag rollback is not permission to erase history.
- `src/app/api/appointments/[id]/complete/route.ts` preserves omitted prepaid tip,
  rejects reducing it, and refuses forged reserved references. Frozen successful
  finalization is exercised through the actual route. This resolves the earlier
  synthetic completion-tip integration gap, not general refund reconciliation.
- Evidence: `server/settleSyntheticCapture.test.ts`, `provenance.test.ts`,
  `server/provenanceReader.test.ts` and
  `server/captureCompletion.integration.test.ts`. Two real-journal full synthetic
  quote-to-capture-to-provenance-to-checkout-to-completion cases passed, including
  added tax. No provider transaction is implied.

## Implemented: lifecycle and database backstops

- `server/lifecycleGuard.ts` checks reserved history under the appointment lock,
  including held/voided markers and with feature flags off. Guards cover actual
  cancel, reopen, transition, reassign, appointment-edit and customer-manage paths.
- `src/app/api/appointments/[id]/payments/[paymentId]/void/route.ts` refuses generic
  void of captured money; manual payment/completion paths reject reserved capture
  references. Captured appointments cannot cancel, reprice, reschedule/reassign
  or reopen before a future explicit reconciliation/refund path exists.
- `migrations/0117_customer_payment_mutation_guards.sql` adds DB backstops for
  tender immutability, appointment financial/lifecycle evidence, item mutations
  and new deposits. This also protects indirect writers such as Google calendar
  ingress/revert, approval expiry, no-show correction, rewards and replacement
  appointment creation. Late held-review captures retain these protections.
- Supported progression and frozen finalization remain possible. Final gross tax
  and tip cannot be silently rewritten. Notes/contact-only changes are not a
  refund or reconciliation operation.
- `salonPurge.ts` fences salon, ordered appointment and client rows before
  destructive mutation, retains reserved markers and maps contention to a typed
  retry conflict. Captured history is never made generically deletable.
- Evidence: affected route/integration tests, real-journal settlement/reporting
  cases and PostgreSQL item/add-on/deposit insertion races. Future reconciliation
  paths need their own explicit authorization, locking and regression proof;
  bypassing these guards is not an acceptable implementation.

## Implemented: immutable capture cash reporting

- `captureReporting.ts`, `server/captureReportingReader.ts` and
  `src/libs/financialReportingServer.ts` read immutable capture-time gross money,
  count it once separately from legacy tender cash, disclose held cash/currency
  and preserve the prepaid tip in canonical upcoming balances. Held cash is not
  inferred to be collectible booking credit. Raw SQL without provenance treats
  tagged balances as unresolved.
- `server/captureReporting.integration.test.ts` has seven passing cases for immutable
  timing, held credit, foreign currency, flag rollback, indirect mutations and
  finalization evidence. This resolves the capture-side voided-marker reporting
  gap. There is still no installed dated refund/fee-refund reporting ledger.

## PostgreSQL and runtime verification boundary

Sixteen cases passed on a dedicated disposable PostgreSQL 16.15 cluster with
four attested physical sessions: five in
`server/preparation.concurrency.integration.test.ts` and eleven in
`server/settlement.concurrency.integration.test.ts`. They cover CAS/replay/caps,
lock ordering, duplicate captures, salon contention with retry/held outcomes and
item/add-on/deposit insertion races and legacy purge contention. The full migration journal was applied there;
the private cluster was stopped and removed. No existing application DB/service
was changed. See `server/README.md` for target attestation and required-mode gates.

Final aggregate: 969 tests passed in 54 files; the 16 opt-in PostgreSQL cases were
skipped there and passed separately. All 14 standalone browser cases passed.
Node 24 standalone typecheck and full production build passed; cache was
temporarily disabled for disk space and the config restored. Six built-app
production-off smoke checks passed, including forced true flags in production.
Scoped lint passed with one browser-harness warning; the secret scan covered
5,566 tracked and 613 generated files. These are scoped checks, not the entire
repository test suite or an authenticated full-app browser journey.
These PostgreSQL proofs do not certify future provider/refund writers.

## Remaining gate 1: real provider operations and receipts

- `checkout.ts` builds parameters only; `attempt.ts` accepts trusted synthetic
  evidence and does not verify signatures. Add durable operation/outbox and
  verified inbox persistence before executing provider calls. Verify signature,
  account, actual mode, session/intent, amount, currency, fee and metadata.
- Revalidate authorization and financial context; use stable idempotency and
  reconcile uncertain outcomes. Browser redirects and owner buttons cannot mark
  payment paid. Keep new collection disabled independently of receipt handling.
- No Stripe test-mode card/Apple Pay execution has occurred. Real test execution,
  wallet/device coverage and provider retry/late-event cases require separate
  authorized testing. Cached Connect flags do not attest provider authorization.

## Remaining gate 2: refund and reconciliation ledger

- Implement immutable principal/tip refund allocations and separate application-
  fee refund receipts in the application ledger, with atomic verified evidence,
  durable operations and invoice adjustment or collection hold. A principal refund
  must not silently reopen collectible balance on an unchanged invoice.
- Preserve captured gross facts and dated refund history across active/completed/
  cancelled states. Pending/failed/uncertain refunds are not money returned.
  Prevent generic void and duplicate/cross-account application; retain out-of-order
  evidence for reconciliation rather than dropping or acknowledging it as applied.
- `refunds.ts`, `accounting.ts`, `attempt.ts` and `server/rehearsalStore.ts` contain
  pure/synthetic refund contracts only. Their passing tests do not install a
  refund writer or make the restrictive lifecycle guards a complete refund flow.
- Required new tests: full/partial principal/tip/fee refunds, rounding, separate
  capture/refund reporting periods, replay/restart, disputes, uncertain provider
  outcomes, attempted recollection, explicit invoice adjustment and PostgreSQL
  races. Earlier-period capture reports must retain original gross money.

## Remaining gate 3: booking, policy and rollout

- `src/app/(unauth)/book/confirm/BookConfirmClient.tsx` is not a new checkout flow.
  Preserve `expectedDepositFingerprint`, booking idempotency/recovery, changed-
  deposit review and existing hold/resume rules. Do not create a competing full
  payment for a deposit hold. Required salon/network deposits override optional
  in-person preference. The unavailable payment-methods page remains unavailable.
- `src/libs/customerAssistant/prepareQuote.server.ts` and the handoff-bound prepare
  route are not generic legacy quote APIs. The staff/admin checkout guard must
  not be weakened for customer operations.
- The public move and later Smart Fit discount remain separate transactions.
  Capture/context checks prevent stale-price posting, but a conflict response can
  arrive after the move has committed. Resolve that UX before enabling collection.
- Treat arbitrary raw SQL writers as outside the verified contract. Official
  tender routes serialize on the parent appointment; the SQL fences are not a
  replacement for that lock protocol or a complete administrative integrity audit.
- Approve fee payer/scope, tax and cancellation/refund terms; customer-paid fees
  remain rejected. Draft owner policy is not live published policy. Connect
  pricing, onboarding, legal obligations and reconciliation operations remain open.
- Before any application migration, preflight existing reserved `cpay_` IDs and
  `customer_payment_capture:` references for collisions or orphan history. Check
  every indirect writer against the parent-lock order and rehearse retry handling;
  the SQL insert fences also serialize legacy writers even with feature flags off.
- Extend booking/deposit regressions, real authenticated Next.js browser journeys,
  accessibility, reporting/receipt checks, full CI and security review. Separately
  approve migration rollout, deployment, pilot activation and monitoring. All
  three feature flags remain false by default; production is refused.
