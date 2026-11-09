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

`provider/stripeReceipt.ts` adds a separate server-only Stripe SDK signature
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
7. Resolve the inherited migration and salonPurge CI review gates documented in
   `customer-payments-base-compatibility.md`; they are not relaxed in this slice.
8. Review application migration preflight/locking and deployment compatibility;
   verify CI and hosted preview; merge protected main; verify the deployed SHA,
   customer/tech journey and provider outcome before activating the selected pilot.

No application migration, Stripe financial operation, live configuration change,
merge, production deployment or customer messaging occurred in this checkpoint.

## Verification at this checkpoint

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
