# Customer payments release work — 2026-11-09

## Authorization and source

The user authorized getting the complete customer payment and post-payment
adjustment flow live on 2026-11-09. This supersedes the earlier no-merge/no-deploy
instruction for payments. Normal CI, review, preview, migration and production
verification requirements still apply; no further generic deployment approval is
needed. Do not interpret this as permission to charge an unspecified real card.

Release worktree: `/Users/me/.codex/worktrees/luster-payments-live-20261109`.
Branch: `codex/luster-payments-live-20261109`.
Base: `8b789552efa62eb72789379108e2df0eea27913f`, fetched from origin/main.
The 16 payment checkpoints through takeover commit `d7b4fbaa` were cherry-picked
without conflicts. This preserves the recently shipped Today/Tomorrow, Services,
Clients and Calendar work. Dot's worktree and the prior takeover remain separate.

The existing production deployment was observed READY at this main SHA on the
Vercel project `isla-nail-studio`, linked to `SniperStopSniping/nailsalon` and
`www.lustergel.app`. This is a deployment metadata observation, not a payment test.

## Product delivery contract

- Appointment -> Payments is available before and after service completion.
  Review & complete shares the same payment state and components.
- A reviewed service change creates a new bill revision. Original payments,
  refunds, tax evidence and invoice history remain intact.
- Only the outstanding difference is requested. The customer authorizes an
  additional online payment; no automatic saved-card charging in this release.
- Deposits are credited exactly once. Tax uses the existing checkout engine.
  A prepaid tip cannot silently cover a new service.
- Techs can request payment, record received offline money and request a refund.
  Refund execution is owner-only initially. Authorization is checked server-side.
- Partial/full refunds are allocated to original payment movements. Pending and
  failed outcomes remain visible; editing a bill never asserts money moved.
- A payment request must be safely resolved before collecting via another method
  or superseding its bill. Unknown outcomes block retry with a new operation.
- Original payment history and receipt processing survive disabling collection.
- Initial pilot recommendation: Isla, zero Luster platform fee, salon-paid Stripe
  costs. The user has been asked which salon/setup to use; no reply was available
  at this checkpoint. No salon setting has been activated.

## Added in this checkpoint

`src/libs/customerPayments/adjustments.ts` projects balances over validated,
tenant-scoped bill/payment/refund/request facts. It rejects duplicate movements,
wrong-tenant evidence, overflow, over-refunds and implicit tip reallocation. It
reserves pending refund allocations, preserves held amounts separately and blocks
collection when a completed request lacks its exact confirmed payment record.
The aggregate revision is distinct from bill revision so payment/refund changes
invalidate stale screens. This is pure accounting, not a persistence or provider
authority boundary.

`AppointmentPaymentsPanel` provides the reusable tech/owner payment presentation,
reasoned owner refund review, double-submit protection, stale review detection
and a mandatory refresh after an uncertain action. It is NOT registered in the
production appointment screens or connected to financial routes yet.

`tests/browser/customerPayments/AdjustmentPreview.tsx` provides a local interactive
preview at `/?view=adjustments`, covering extra payment, removal/refund, deposit
and unpaid examples. Its simulated confirmations are explicitly labeled. It
does not contact providers, write application records or send messages.

`liveProvider/stripeReceipt.ts` adds a separate server-only Stripe SDK signature
verification boundary. It bounds raw payloads and signature timestamps, checks
configured mode and account scope, excludes customer/card/URL/signature data and
retains signed unsupported-version/object facts for review. Its private in-memory
provenance cannot be manufactured by JSON. A receipt remains nonfinancial until
durably retained and correlated to the exact saved operation. It is NOT registered
as a webhook or a settlement writer. Tests use signed fixtures, not Stripe events.

The inherited `salonPurge.ts` extension was made strictly additive over main and
the V133 reviewed head, preserving the existing error type and ordered locking.
Its CI postimage admission remains pending; no release guard was relaxed.

## Environment blocker discovered

The test key in the primary worktree's `.env.local` received Stripe HTTP 401
(`StripeAuthenticationError`) on a read-only account request. The development
environment file contains the same key, so it was not retried. No key value was
printed or copied into this release worktree.

Vercel environment metadata confirms a global Preview `STRIPE_SECRET_KEY`, stored
as sensitive, but no Preview `STRIPE_CONNECT_WEBHOOK_SECRET`. Production does have
Stripe/Connect secret variable names. Presence does not prove their values, mode,
account readiness or webhook delivery. Secret values were not retrieved or changed.

The user has been asked to identify a working sandbox setup or configure it through
the appropriate environment UI without pasting secrets into chat. Independent local
work can continue, but actual provider journey verification cannot pass with the
rejected local key or missing Preview Connect signing configuration.

## Remaining implementation and release gates

### Durable backend continuation

The follow-up now implements a separate real-provider workspace in migration
0128 and `customerPayments/server/workspaceRepository.ts`. Committed operations,
invoice revision/reason history, owner refund approval, short dispatch leases,
stable Stripe idempotency, immutable receipts/observations/settlements and a
canonical `lpay_` tender are persisted. The synthetic tables remain test-only.

`liveProvider/workspaceStripe.ts` calls the pinned Stripe SDK on the saved
connected account. Create responses never credit money. Independent Session,
PaymentIntent, charge and refund reads must agree with the saved operation before
settlement. Pending/external refunds, disputes, changed accounts, competing
objects and conflicting signed events retain holds. Existing canonical readers
now verify these real settlements and subtract immutable refunds without rewriting
the original gross payment. Turning off collection leaves historical reads and
reconciliation available.

Open links can be expired using a separately committed cancellation permit.
Independent retrieval determines whether cancellation or a simultaneous payment
won. Timeout/error responses never free the bill for another charge.

`/api/webhooks/customer-payments` uses bounded raw-body signature verification,
durable retention before acknowledgement, saved-operation recovery from signed
metadata, and awaited independent reconciliation. No real endpoint is configured
yet. This route requires `STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET`,
`CUSTOMER_PAYMENTS_STRIPE_WEBHOOK_ENDPOINT_ID`, and
`CUSTOMER_PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID`, with the endpoint configured for
connected-account events and API version `2024-06-20`. Provider writes additionally
require `CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED=true`; it remains unset.

This is **not a live customer flow**. The authenticated appointment/customer
routes, authoritative invoice/item adapter, owner opt-in settings, complete
receipt and payment-link/QR flow, and recovery scheduling still need wiring.
The invoice adapter now reads booked/final line items, frozen tax, deposits and
canonical tender under the appointment lock. Initialization retains that readable
invoice in the immutable audit; later bill changes must supply a matching invoice.
The actual item-edit writer and checkout completion integration remain open. Manual-payment callbacks must use that existing
canonical writer and its loyalty/audit behavior. No synthetic SDK test is a
substitute for the actual Stripe sandbox journey.

CI regression fixes keep the original guards: the real SDK was moved outside the
inert provider directory; booking uses `SectionCard`; the default-off browser
fixture supplies its server gate; deposit read sites and migration-tail fixtures
are enumerated. The exact version-only 1.151.2 manifest pair was verified, and CI
builds receive a 6 GiB Node heap after the observed default-heap OOM. The 45 native
PostgreSQL payment checks are now explicit with a zero-skip requirement. The 0115-0128 migration packet and strictly additive purge postimage now have
exact CI pins, retaining the immutable-history and append-only checks. Production
migration preflight and rehearsal on the actual deployment target remain open.

The complete Preview environment listing was rechecked via the CLI because the
connector returned a truncated list. Global Preview has a sensitive Stripe key,
but its value cannot be retrieved for local use; neither the Connect webhook
secret nor the dedicated new customer-payment webhook configuration is present.
Browser access is disabled in Work settings, so the Stripe dashboard could not
be inspected. `scripts/verify-customer-payment-preview-provider.mjs` provides a
read-only test-key/account attestation for a protected Preview build without
exporting credentials or touching a database or payment.

The remaining delivery checklist below includes items only partially completed
by this backend work:

1. Persistent bill revisions, refund approvals and operations with atomic scope,
   revision, idempotency, financial reservations and immutable audit history.
2. Real Stripe create/retrieve/refund operations using committed dispatch permits;
   verified inbox retention and independent consumer delivery, then canonical
   settlement/refund/credit projection. Do not promote old synthetic facts.
3. Safe resolution of payment/refund uncertainty and old payment requests before
   releasing holds. Preserve late payments for reconciliation.
4. Wire the existing checkout and receipt surfaces, customer capability-bound
   payment link/QR flow, owner payment settings and permissions to that backend.
5. Protect all existing completion, manual collection, repricing, cancellation,
   calendar and reporting paths. Preserve gross history and resolved net balances.
6. Actual sandbox journeys: create booking, deposit/full payment, extra payment,
   partial/full refund, timeout/retry, late/repeated events and mixed tenders.
7. Verify the narrowly pinned 0115-0128 migration and additive salonPurge packet
   in hosted CI; candidate pins do not constitute application-migration readiness.
8. Review application migration preflight/locking and deployment compatibility;
   verify CI and hosted preview; merge protected main; verify the deployed SHA,
   customer/tech journey and provider outcome before activating the selected pilot.

No application migration, Stripe financial operation, live configuration change,
merge, production deployment or customer messaging occurred in this checkpoint.

## Historical verification at checkpoint 61562fd7

- New accounting, panel and signed-receipt suites: 60 assertions across three
  files. Signed events are locally generated protocol fixtures.
- Customer payment browser suite: 26 checks passed across desktop Chromium and
  iPhone WebKit. These explicitly simulated screens do not prove provider delivery.
- Real disposable PostgreSQL settlement/reservation races: 42 assertions passed,
  including parent-first purge contention and mutation protection. The isolated
  loopback database was stopped and removed after the run.
- Salon purge integration suite: 22 assertions passed against PGlite migrations.
- TypeScript, scoped ESLint and whitespace checks passed. The browser entry file
  retains two existing Fast Refresh warnings; no lint errors.
- Secret scan passed across 5,751 tracked files and the 16 inherited commits.
- This worktree has not completed a production build, hosted preview acceptance,
  hosted CI or an actual Stripe financial journey. Earlier takeover build evidence
  is not represented as a build of this revision.

## Durable backend validation follow-up

- The expanded migrated-PGlite workspace and pinned-SDK integration suites pass
  all 24 cases, including cancellation versus simultaneous payment, manual tender
  cache updates, signed recovery of a lost Session response and owner-approved
  refunds. Provider responses in these tests are simulated.
- The dedicated webhook, signature, schema-tail and provider-boundary suites
  passed in the earlier 99-case run; the preview fixture portion then exposed
  its missing exact incoming-FK identity. The customer-payment policy and owner
  credit-decision references are now included without relaxing cleanup refusal.
- The exact protected-surface workflow body passed locally after staging the
  candidate packet. CI contract tests additionally exercise mutation rejection
  for every payment migration and preserve Next Visit as the final schema-reset
  suite in its disposable PostgreSQL job.
- Secret scan passed across 5,763 tracked files and 17 reviewed commits.
- All 45 native PostgreSQL payment concurrency checks passed with zero skips;
  the owned loopback cluster was stopped and removed. All 42 preview fixture
  checks and 28 CI workflow contracts passed. The first fixture rerun accidentally
  used a production test runner, which correctly disabled its test-only TLS seam;
  rerunning under the normal test environment passed the full file.
- Scoped ESLint passes with three existing Fast Refresh warnings in BookConfirm.
  The full TypeScript check also passed. The hosted build remains pending; these
  backend checks do not establish live-flow acceptance.

## Hosted checkpoint and invoice integration

Committed backend `106497dd` was merged with current main `3effca59` on the feature
branch, producing pushed checkpoint `bbcb7dd79a53954cd5886a1dd96cfbc68d7992f1`.
Draft PR #504 remains unmerged. Vercel Preview deployment
`dpl_3369vWHMFdxRm6yUSSYr3mB3qh9y` reached READY at that SHA. The read-only build
probe authenticated the existing test key on platform `acct_1SdpJKPOewmPdOib`:
zero connected accounts, no additional account page and zero ready Canadian
Standard accounts. No provider or database mutation was performed by this probe.

Protected HTTP checks: homepage 200; `/api/health` 503 with expected `gitSha`
`bbcb7dd`, `db=true`, `redis=true`, `stripeEnv=true`, `stripeConnectEnv=false` and
`schemaDrift=not_ready`. Several other Preview provider settings are also absent.
READY is build evidence, not a successful financial journey or release clearance.

GitHub run 42727138878 has passed builds on Node 20, 22 and 24, secret hygiene,
the protected-surface gate and the native payment race job. The broader application
and browser checks were still running at this observation.

The next invoice-source change adds seven actual-table integration checks: tax
mode preservation, private-data exclusion, deposit plus cash allocation, pending
deposit refunds, stale totals/cache rejection, frozen actual invoices and changed
source hashes. The repository additionally rechecks staff assignment under its
appointment lock, before reads and commands; a reassigned tech loses access.
The invoice and workspace/provider suites total 32 passing cases. Full TypeScript,
scoped lint and the tracked-tree secret scan pass for this follow-up. The final
assignment-guard change is additionally covered by the 25-case provider/repository
rerun. These remain backend checks, not an authenticated customer journey.
