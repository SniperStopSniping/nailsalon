# Customer payment integration gates

Status: default-off nonproduction preparation plus **internal synthetic** capture/refund,
canonical-reader, lifecycle, reporting, bounded readonly credit review and an
offline signed-fixture inbox/outbox.
No provider collection, real refunds, deployment or production activation.
Migrations 0115–0120 exist in source and have run through the real journal in isolated/disposable tests only,
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
  or reopen before a future explicit review-resolution path exists.
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
  gap. Dated synthetic refund reporting is now implemented as described below.

## Implemented: synthetic refunds, holds and dated reporting

- `server/recordSyntheticRefund.ts`, `refundTestGate.ts`,
  `src/models/customerPaymentSchema.ts` and migration
  `0118_customer_payment_synthetic_refunds.sql` persist immutable successful
  synthetic customer refunds, fee bindings, fee returns and replay receipts.
  They accept known posted CAD captures, bind account/intent/mode/currency and
  independently bind original application-fee identity. They are internal fixture
  seams, not refund APIs, provider operations or signature verification.
- Observed successful but invalid/out-of-order allocation facts are held for
  review, not discarded or treated as failed money movement. Only applied
  principal/tip allocations reduce the trusted paid cache. Original gross tender,
  final invoice tip and tax remain immutable. A fee return is independent platform
  money and never reduces customer cash or booking credit.
- `provenance.ts`, `server/provenanceReader.ts`, `appointmentPaymentLedger.ts` and
  migration 0118 impose a permanent-in-this-slice collection hold after any
  customer refund, including held facts. Actual checkout, manual payment,
  completion and lifecycle actions fail closed. Generic void cannot erase the
  history; reducing cached payment does not make the old invoice collectible.
  Late distinct captures are retained under review, not used to revive credit.
- `refundReporting.ts` and `server/refundReportingReader.ts` report successful
  observed customer/fee movements by their own dates. Review totals are subsets
  of cash movements. `financialReportingServer.ts` preserves gross cashCollected,
  reports customer net as captures minus customer refunds only and merges returned
  capture anchors for between-query arrivals. Negative refund-only net is valid.
- `financialReportingSerializer.ts`, `src/types/admin.ts`,
  `OwnerTodayWorkspace.tsx` and client-hub reports forward seven optional customer
  metrics. Owner breakdown explains gross, net, review subsets and separate
  platform fee returns; missing net is omitted. Earned-service charts, legacy
  amountPaid and deposit-refund semantics remain unchanged. No refund UI is added.
- `server/refundReportingReader.test.ts` proves legacy no-marker paths only probe
  old tables and ledger-off markers fail closed. Reads deliberately ignore the
  refund-write flag. `server/refundReporting.arrival.integration.test.ts` injects
  real synthetic capture/refund between queries and verifies 12000 gross, 3000
  refund and 9000 net. Five `server/refundReporting.integration.test.ts` cases
  cover dated cash, duplicates, separate fee evidence, held facts and full returns.
- `server/recordSyntheticRefund.test.ts`,
  `server/refundLifecycle.integration.test.ts` and
  `server/refund.concurrency.integration.test.ts` exercise writer, canonical hold
  and concurrent fixture behavior. These do not certify a future provider driver.

## Implemented: bounded synthetic credit decisions

- `creditReviewTestGate.ts` adds the fifth default-off control,
  `CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED=false`. Both owner GET/POST
  `/api/admin/appointments/[id]/customer-payment-review?salonSlug=...` and the
  dedicated `/{locale}/payment-review/{slug}/{appointmentId}` page require it plus
  the preparation and ledger-test gates, and refuse production. The refund-write
  flag may remain off.
  Genuine owner authentication supplies the actor; impersonation is rejected.
  Scope is tenant-bound and POST requires same origin. The server writer also
  locks/rechecks actual owner membership rather than trusting body actor fields.
- `server/recordSyntheticCreditDecision.ts`, `creditResolution.ts` and migration
  `0119_customer_payment_credit_review.sql` accept only clean completed finalized
  CAD invoices equal to one posted synthetic capture/sole tender, no deposits or
  extra tenders, all customer refunds applied, and an exact net paid cache.
  Held or unknown customer money and uncompleted invoices remain ineligible.
- Immutable decisions record actor/reason/request, authoritative current evidence,
  predecessor, cumulative service/tax/tip credits and corresponding new delta
  credits. Explicit service plus tax equals cumulative refunded principal; tip
  equals refunded tip. Original component caps and monotonic component history
  prevent reclassification or double counting. Never sum cumulative decisions.
  No original invoice, tender, final tax/tip, refund movement or paid cache changes.
- `server/creditEvidence.ts` binds the current locked customer money/invoice state;
  the pure projection has its own validated fingerprint. New customer capture or
  refund evidence invalidates the decision. Duplicate transport, notes/contact
  edits and independent fee movements do not stale customer credit. Replays are
  historical acknowledgements only, not new authority or cash effects.
- The dedicated owner UI must distinguish proposed allocation/adjusted amounts
  from a recorded current decision and require explicit review before recording.
  Valid proposals are labeled proposed; invalid allocations remain unresolved.
  Recording is acknowledged separately, and a fresh verified GET is required
  before recorded credit and verified adjusted balance appear. Browser tests cover
  this distinction, interrupted retries and stale/navigation responses.
  Every credit allocation/document remains synthetic and nonlegal, not an official
  tax credit note, tax determination, refund button or checkout permission.
- `server/creditResolutionReader.ts` is the bounded opt-in bridge used only by
  `getFinancialBalanceSummary` and `getCompletedOutstandingRows` for debt summary
  and segmentation. It verifies a current decision as of the reporting cutoff,
  zero adjusted collectible balance and `ordinaryActionsBlocked: true`.
  `getCompletedFinancialResolution`/`getCompletedFinancialRows` and generic spend,
  receipt and communication consumers remain under review. Original dated cash,
  refund and earned-service metrics are not rewritten as credits or new spending.
- SQL and ordinary collection/lifecycle holds remain unchanged, including manual
  collection, completion, cancellation, reopen, repricing and service progression.
  Existing readonly credit survives review/refund write-flag rollback, but base
  preparation/ledger disablement and production fail closed. The legacy no-marker
  fast path does not query new payment tables. This is not global hold clearing.

## Previous capture verification: `7608d3b4`

The following aggregate/build results predate the refund and credit-review slices.
They are retained as historical evidence only, not current build/typecheck certification.

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
These PostgreSQL proofs do not certify future provider execution.

## Previous refund verification boundary: `84763bd`

These results are historical evidence for the committed refund checkpoint, not
certification of later credit-review changes; their checks are recorded below.

Final scoped aggregate: **1,075 tests passed in 63 files**. The 23 opt-in
PostgreSQL cases were skipped in that aggregate and passed separately on a newly
created private PostgreSQL 16.15 cluster: seven refund cases plus the prior 16
preparation/settlement/purge cases. Every physical session was attested; the
cluster and ephemeral secrets were removed afterward. No application DB was used.

The final aggregate includes the 21-case synthetic refund writer suite, actual
full/partial/tip-only lifecycle holds, immutable SQL defenses, dated refund
reporting, arrival races, optional-field serialization and owner disclosures.
Whitespace-only external identities are rejected before DB access and by SQL;
valid identities are preserved exactly. Independent review found no remaining
blocker in this slice.

All 14 standalone Chromium/mobile WebKit rehearsal cases passed. Node 24
standalone typecheck, scoped lint and the full production build passed. Webpack
cache was temporarily disabled only for local disk space; configuration was
restored and type checking was not bypassed. All six built-app production-off
checks returned 404, both with default flags and all four flags forced true in
production. The secret scan passed across 5,579 tracked and 613 generated files.

These are scoped checks, not the whole repository suite, an authenticated
full-app customer journey or real provider execution. No provider call, actual
charge/refund, application migration, push, deployment or activation occurred.

## Previous credit-review checkpoint: `3585d41d`

Final scoped aggregate: **1,152 tests passed in 73 files**. The 27 opt-in
PostgreSQL cases were skipped there and passed separately on genuine PostgreSQL
16.15: four credit-decision cases plus the prior 23 preparation/capture/refund/
purge cases. The run included the final 0119 SQL. The newly created private
cluster and ephemeral secrets were removed; no application database was used.

Coverage includes owner/tenant checks, immutable original invoice/cash, tax
allocations, cumulative/delta chains, exact replay, later-evidence invalidation,
independent fee movements, base/write flag boundaries and continued ordinary
holds. Independent source and taxed lifecycle review found no remaining blocker
in this bounded slice. A proposed-versus-recorded display defect was corrected;
the nine affected component tests passed again after the final text spacing fix.

All **20 standalone Chromium/mobile WebKit cases passed** on final source,
including six new credit-review cases with mock transport and no external
requests. Node 24 standalone typecheck and full production build passed. Scoped
lint passed with two Fast Refresh warnings in the standalone harness. Webpack
cache was disabled temporarily for local disk space and the configuration restored;
no type-check bypass was used.

All **12 built-app production-off checks returned 404**, covering draft settings,
quotes, rehearsal, review GET/POST and the new review page with default flags and
all five flags forced true in production. Secret scan passed across **5,603
tracked files and 615 generated files**.

These are scoped checks, not the entire repository suite or an authenticated
full-app success journey. The credit allocations remain synthetic/nonlegal.
No provider execution, application migration, push, deployment or activation
occurred. `docs/customer-payments-provider-adapter-plan.md` is a source-backed
assessment only; it installs no adapter or webhook.

## Remaining gate 1: real provider operations and receipts

- `checkout.ts` builds parameters only; `attempt.ts` accepts trusted synthetic
  evidence and does not verify signatures. Extend the offline journal below to a
  separately authorized real adapter before provider calls. Verify signature,
  account, actual mode, session/intent, amount, currency, fee and metadata.
- Revalidate authorization and financial context; use stable idempotency and
  reconcile uncertain outcomes. Browser redirects and owner buttons cannot mark
  payment paid. Keep new collection disabled independently of receipt handling.
- No Stripe test-mode card/Apple Pay execution has occurred. Real test execution,
  wallet/device coverage and provider retry/late-event cases require separate
  authorized testing. Cached Connect flags do not attest provider authorization.

## Offline provider journal checkpoint

Additive migration 0120 and `server/providerJournal.ts` now persist offline signed fixture
receipts, conflict evidence, independent consumer/version deliveries, immutable
operation identities and append-only transition audits. Original raw payloads,
signature values and customer details are not stored. Private runtime provenance
prevents arbitrary deserialized objects from entering the receipt seam.

`provider/dispatchFixture.ts` persists dispatch intent before a closed fake
transport executes, then records a version/lease-bound result. Missing results
remain uncertain; explicit reconciliation preserves the original identity and
conservative retention window. `provider/inspectFixture.ts` leaves relevant money
under review and cannot suppress another consumer's delivery.

This is not a real verified provider driver. The sixth switch requires
`NODE_ENV=test`, preparation enabled and no production marker. No application
route or worker imports it, and there is no financial bridge or canonical money
mutation. See `docs/customer-payments-provider-adapter-plan.md` and the provider
README for exact scope and remaining external-test prerequisites.

Verification on final runtime/SQL:

- **1,249 tests passed in 79 files** in the scoped regression aggregate. The 31
  opt-in PostgreSQL cases were skipped there and passed separately in five files
  on genuine PostgreSQL 16.15, including four new provider-journal cases.
- Independent boundary tests cover offline signature provenance, forgery, SQL
  null validation, per-consumer dispatch, conflicts, unknown evidence and unchanged
  money tables. Full-journal tests cover durable dispatch, uncertain recovery,
  immutable audit commands and suppressed-write failure. These overlap the
  aggregate and are not additional counts.
- Node 24 typecheck, scoped lint and the full production build passed. Local
  webpack cache was temporarily disabled to preserve disk space, then restored;
  no type-check bypass was used.
- All **20 standalone desktop/mobile browser cases** passed with mock transports.
  All **12 built-app production-off checks** returned 404 with default flags and
  all six flags forced true in production. The fixture entry points' strict
  test-only refusal and lack of application imports are independently tested.
- The private PostgreSQL cluster, temporary secrets and owned test servers were
  removed. No application migration, provider execution, push or deployment was
  performed. These are scoped checks, not the entire repository suite, an
  authenticated full-app journey or real card/Apple Pay execution.

## Remaining gate 2: real refunds and explicit review resolution

- The application-table synthetic ledger and offline fixture journal are
  implemented, but a real refund operation driver and verified provider-to-money
  adapter are not. Real unknown/unsupported capture evidence needs approved
  authenticated receipt handling before a future provider event is acknowledged.
- Extend the bounded synthetic readonly decisions above to separately authorized
  broader review resolution, legal invoice credit documents/adjustments and
  collection/lifecycle hold clearing. None of those broader operations exists
  here; ordinary holds remain. Do not make a refunded unchanged invoice
  collectible or use generic void, row edits or flag changes to bypass the hold.
- Preserve gross capture facts, independent customer/fee identities and dated
  history through disputes and late/out-of-order provider events. Pending,
  failed and uncertain operations are not confirmed money returned; first
  reconcile uncertain outcomes before retrying a provider operation.
- Extend the existing synthetic full/partial/replay/race tests to actual authorized
  provider test execution, unmatched receipts, explicit review resolution and
  hold clearing. Earlier-period cash must retain its original gross capture.
  `refunds.ts`, `accounting.ts`, `attempt.ts` and `server/rehearsalStore.ts` still
  supply supporting pure/local contracts, not a real refund driver.

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
  six feature flags remain false by default; production is refused.
  Refund and credit-review writes depend on the preparation/ledger-test gates;
  credit-review does not require the refund-write gate. None authorizes a provider
  call or ordinary collection/lifecycle hold clearing.
