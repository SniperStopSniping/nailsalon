# Customer payments: disabled preparation, synthetic money and credit review

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
  explicit review-resolution path exists. Safe supported progression and
  frozen finalization remain possible; final tax/tip evidence cannot be rewritten.
  Destructive reset/purge retains reserved money history, fences parent/client
  rows first and returns a retryable conflict on contention without partial deletion.
- Immutable capture-time reporting now counts synthetic gross cash once, includes
  held cash separately, handles currency disclosure and avoids treating held
  money as booking credit. Separate dated synthetic refund reporting is now implemented below.
- Ordinary untagged legacy rows do not query the new payment tables. Switching
  flags off does not turn reserved markers into manual tender or remove their
  lifecycle protection. Tagged money becomes unresolved rather than silently
  disappearing from collectible-balance decisions.

### Internal synthetic refunds and collection holds

- `server/recordSyntheticRefund.ts` and migration
  `0118_customer_payment_synthetic_refunds.sql` add immutable successful customer
  refund movements, independent application-fee bindings/returns and replay
  receipts. This records explicitly successful synthetic evidence against a known
  posted CAD capture; it never calls a provider or starts a real refund.
- Customer refund identity binds the original capture, account, intent, mode and
  currency. Application fees have their own bound fee identity and refund IDs.
  A customer refund does not claim a fee was returned. Duplicate receipts do not
  repeat money effects; conflicting identity fails closed.
- Successful observed movements with invalid/out-of-order allocations are retained
  under review. Their full observed amount is cash-out for reporting, but only
  applied principal/tip allocations reduce the trusted appointment paid cache.
  Original gross tender, invoice tip and tax are not rewritten. Fee returns never
  reduce customer credit or customer net cash.
- Any customer refund, applied or held, imposes a collection hold with no clearing
  operation in this slice. Canonical actions fail closed rather than presenting
  refunded principal as newly collectible. Generic void, recollection and
  completion/lifecycle shortcuts cannot clear that hold. Later distinct captures
  are still retained as held evidence without restoring usable credit.
- `refundReporting.ts`, `server/refundReportingReader.ts` and financial summaries
  date refunds by their own event time. Earlier capture periods retain gross
  inflow. Same-period capture anchors are merged when a refund arrives between
  queries. Customer net cash can be negative; it excludes platform fee returns.
- Owner reporting and client-hub serialization expose gross, refund, net and review
  amounts separately. Review amounts are subsets, not additional deductions.
  Platform fee refunds are separate platform money, not profit or payouts. An
  absent optional net value is not displayed as zero. Earned-service charts and
  existing deposit-refund behavior are unchanged. No refund button/API is added.
- Historical reads ignore the refund-write flag. Turning off future writes cannot
  erase refunds or holds. Ledger-off markers fail closed; ordinary untagged legacy
  data still does not read the new payment tables.

### Bounded synthetic credit review

- Migration `0119_customer_payment_credit_review.sql` and
  `server/recordSyntheticCreditDecision.ts` add immutable explicit owner decisions.
  Eligibility is limited to completed, finalized CAD invoices exactly matching
  one clean posted synthetic capture and its sole gross tender, with no deposits,
  additional tenders or held/unknown customer money. Customer refunds must all be
  applied and agree with the net paid cache. Unfinalized and ambiguous cases remain
  under review.
- The genuine-owner GET/POST
  `/api/admin/appointments/[id]/customer-payment-review?salonSlug=...` and dedicated
  `/{locale}/payment-review/{slug}/{appointmentId}` test page are separate from
  checkout. The API derives its actor from real owner authentication, rejects
  impersonation, checks tenant ownership and same-origin writes, and the writer
  locks and rechecks actual owner membership. A request cannot supply its actor.
- An owner explicitly allocates cumulative service, tax and tip obligation credit.
  Service plus tax must equal applied principal refunds; tip must equal refunded
  tip. Components are bounded by the original invoice and cannot decrease across
  decisions. Each decision records its predecessor and only the new delta credit.
  Never sum cumulative snapshots. These are synthetic, nonlegal allocations, not
  tax advice, official tax credit notes or new cash payments.
- The immutable decision binds the finalized invoice and complete customer capture
  and refund evidence under the appointment lock. New customer monetary evidence
  makes the recorded resolution stale and requires a new review. Duplicate delivery
  receipts, notes/contact edits and independent fee returns do not change that
  customer-obligation revision. Historical retries acknowledge their original
  decision without granting current authority.
- `creditResolution.ts` keeps original gross invoice, tender, tip and tax unchanged
  and projects original, credited and adjusted amounts separately from actual net
  customer cash. Only debt summary and completed-outstanding segmentation reads
  opt into verified zero adjusted collectible balance. Generic spend/receipt
  readers and collection, completion, reopen, cancellation, repricing and service
  progression remain blocked after a refund. No global SQL or action hold clears.
- Existing readonly resolution survives disabling the review/refund write flags.
  Base preparation/ledger disablement or production remains unresolved and fail
  closed. Untagged legacy reads do not load new payment tables.
- UI acceptance requires an explicit distinction between proposed allocations and
  a recorded current decision. Before recording, any adjusted-zero outcome is a
  proposal, never an assertion that a credit exists. A fresh verified read after
  recording is required before showing recorded credit and verified adjusted
  balance. Component and browser tests cover this distinction.

### Separate rehearsal and pure foundations

`CustomerPaymentsRehearsal.tsx` remains a synthetic presentation fixture with a
CA$105 service and example 13% tax, not a tax recommendation. Its controlled
chooser demonstrates tips, breakdowns and deposit/full/in-person policies. Those
fixture options do not expand the narrower persisted preparation eligibility.

Pure quote/accounting, Checkout-parameter, attempt and proportional fee-refund
helpers plus the temporary PGlite rehearsal store remain foundations. Synthetic
refund receipts in that isolated store remain separate from the new application-table
synthetic refund seam. Neither is a verified webhook driver or real refund. The proposed CA$1 Luster fee is
configurable and salon-paid here; Stripe processing expense is not invented as
an actual customer charge. Apple Pay would be offered by Stripe only when eligible.

## Six default-off controls

- `CUSTOMER_PAYMENTS_REHEARSAL_ENABLED=false`: presentation-only
  `/en/payments-rehearsal`; no persisted salon settings or money.
- `CUSTOMER_PAYMENTS_PREPARATION_ENABLED=false`: owner draft and capability quote
  APIs plus their gated UI. Requires reviewed preparation schema and authorized
  local/disposable fixtures.
- `CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED=false`: internal synthetic capture and
  provenance/reporting fixture integration; also requires preparation enabled.
  Requires the reviewed settlement/guard migrations in disposable infrastructure.

- `CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED=false`: internal synthetic refund/fee
  evidence writes; also requires the preparation and ledger-test gates. Requires
  the reviewed refund schema in disposable infrastructure. It does not enable
  a provider refund operation or clear any hold.

- `CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED=false`: genuine-owner synthetic
  credit-review API and dedicated test page; also requires preparation and
  ledger-test gates. The refund-write flag may remain off. It records an immutable
  obligation decision, not cash,
  a provider refund or permission to resume ordinary appointment actions.

- `CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED=false`: signed offline receipt and
  outbox fixtures with a closed fake transport. Requires preparation enabled and
  `NODE_ENV=test`; it has no route, scheduled worker or financial posting authority.

Production is refused by all six controls. None enables Stripe execution. Do not
enable these against an unreviewed or shared application database. Migrations 0115–0121 have been
exercised through the real journal in isolated fixtures/disposable PostgreSQL,
not applied to a development, preview or production application DB.

The standalone browser harness needs neither application DB nor provider access:

```sh
./node_modules/.bin/playwright test --config tests/browser/customerPayments/playwright.config.ts
```

It binds to loopback. Owner-draft and customer-quote transports are explicitly
mocked. It does not certify the authenticated full Next.js/database journey.

## Previous capture checkpoint: `7608d3b4` (2026-11-08)

These results belong to the committed capture milestone. They do not certify the
subsequent refund or credit-review diffs, aggregates, typechecks or builds.

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

## Previous refund checkpoint: `84763bd`

These completed checks belong to the refund checkpoint. They are historical, not
certification of later credit-review changes; their checks are recorded below.

- Final scoped aggregate: **1,075 tests passed in 63 files**. The 23 opt-in
  PostgreSQL cases were skipped there and passed separately on PostgreSQL 16.15:
  seven refund races plus 16 preparation/settlement/purge cases. The new private
  attested cluster and ephemeral secrets were removed after the run.
- Coverage includes the 21-case writer suite, full/partial/tip-only refund holds,
  raw SQL defenses, exact replay, independent fee receipts, later-period refund
  cash, review amounts, arrival races, legacy no-new-table reads and owner/client-
  hub serialization. Blank identities are rejected without rewriting valid IDs.
  Independent review found no remaining blocker in this slice.
- All 14 standalone Chromium/mobile WebKit rehearsal cases passed. They are mock
  and synthetic flows, not authenticated full-app or Stripe wallet execution.
- Node 24 standalone typecheck, scoped lint and full production build passed.
  Webpack cache was temporarily disabled for local disk space, then restored;
  no type-check bypass was used.
- Six built-app production-off checks returned 404 for owner drafts, public quotes
  and rehearsal, both with default flags and all four flags forced true in
  production. Internal refund production refusal is separately unit-tested.
- Secret scan passed across 5,579 tracked and 613 generated files. These checks
  are scoped, not the complete repository suite or approval for live collection.
  No application DB migration, provider call, real charge/refund, push,
  deployment or activation was performed.

## Previous credit-review checkpoint: `3585d41d`

- Final scoped aggregate: **1,152 tests passed in 73 files**. The 27 opt-in
  PostgreSQL cases were skipped there and passed separately on PostgreSQL 16.15:
  four new decision races plus 23 preparation/capture/refund/purge cases. The run
  used final 0119 SQL and separately attested physical sessions. The private
  cluster and ephemeral secrets were removed after testing.
- Independent review and full-journal lifecycle tests cover taxed allocations,
  immutable originals, owner checks, monotonic credit deltas, replay, later cash
  invalidation, fee independence and continued ordinary action holds. The nine
  component tests passed again after the final display/spacing corrections.
- All **20 standalone Chromium/mobile WebKit cases passed** on final source,
  including six new credit-review cases. These use mock API transport, not an
  authenticated full-app owner/database or real Stripe journey.
- Node 24 standalone typecheck and full production build passed. Scoped lint
  passed with two standalone-harness Fast Refresh warnings. Webpack cache was
  temporarily disabled for local disk space, then configuration restored; no
  type-check bypass was used.
- All **12 built-app production-off checks returned 404**, with default flags and
  all five flags forced true in production. They cover owner drafts, quotes,
  rehearsal, review GET/POST and the new review page. Secret scan passed across
  **5,603 tracked files and 615 generated files**.
- These checks are scoped, not the complete repository suite or approval for
  rollout. The provider-adapter plan is an assessment only. No provider call,
  application database migration, real charge/refund, push, deployment or
  activation occurred. Credit notes remain synthetic/nonlegal and ordinary
  collection/lifecycle holds remain enforced.

## Previous provider-journal checkpoint: `af3baf98`

The additive migration 0120 journal persists authenticated offline fixture receipts, immutable
operation identities, consumer-specific deliveries and audited state transitions.
Original raw payloads and signatures are not stored. The signed fixture provenance
cannot be converted into synthetic or real money authority.

A privately branded closed response map exercises dispatch and reconciliation.
Dispatch intent must be durably saved first. A lost response or uncertain result
cannot cause a blind resend, a new operation or a reset idempotency window.
Consumer inspection keeps relevant money under review, while unrelated consumers
can finish their own inspection without suppressing that review.

This is an offline implementation, not real Stripe integration. No endpoint,
account, credential, financial row or application deployment is changed. See
`docs/customer-payments-provider-adapter-plan.md` for remaining provider work.

Final verification: **1,249 scoped regressions passed**, plus **31 actual
PostgreSQL cases** run separately and **20 mock desktop/mobile browser cases**.
Standalone typecheck, scoped lint, production build and **12 production-off
checks** passed, including all six flags forced true in production. No type bypass
was used; the temporary local webpack-cache change was restored. Private test
infrastructure was removed. See the integration-gates document for test overlap
and the remaining unverified external/full-app boundary.

## Offline capture-correlation checkpoint

Separate signed Session supplements now link the successful operation's Session
to its intent and charge without changing old reviewed receipts. Charge candidates
are deduplicated across event and endpoint deliveries. Exact quote/account/mode/
currency/amount relationships are required, with fees checked separately.

Missing evidence stays pending; conflicting money or competing owners remain
review. Guarded reads rebuild the full bounded evidence closure and charge claims,
including later conflicting payloads, rather than trusting a cached result.
Snapshot start and evaluation time are separate. Every result prohibits financial
posting, and original collection holds and all financial tables remain unchanged.

Correlation verification: **1,344 scoped regressions passed**, plus **35 actual
PostgreSQL cases** run separately and **20 mock desktop/mobile browser cases**.
The new PostgreSQL coverage includes stale writer snapshots, duplicate charge
ownership and conflicts arriving during a read. Private test infrastructure was
removed. These results do not establish real provider or financial authority.
Standalone Node 24 typecheck, scoped lint, the production build with type
validation and all **12 built-app production-off checks** passed. The temporary cache setting was restored. No
application migration, provider call, push, deployment or spend was performed.

## Remaining gates before collection

1. Approve fee payer, fee scope, tax, cancellation/refund policy and operational
   responsibilities. Customer-paid surcharges remain unsupported. CA$1 revenue
   is not net profit; actual Stripe/Connect costs and account settings need review.
2. Connect the offline journal patterns to a separately authorized real provider
   adapter with account, mode, session, intent, amount, currency and fee binding.
   A redirect is never payment evidence. Recheck actual test-mode credentials and
   account authorization before any separately approved provider execution.
3. Add a real refund operation driver and authenticated unmatched-evidence ingress. The current
   synthetic seam accepts known posted captures only; it is not general provider
   event retention. The bounded synthetic readonly credit decisions above do not
   implement legal credit documents, broader invoice adjustments or authorized
   collection/lifecycle hold clearing. Those holds remain in place. Preserve
   gross history, refund dates and fee separation through disputes, out-of-order events and reconciliation.
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
