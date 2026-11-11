# Customer payments release work — 2026-11-09

## Current checkpoint: scheduled recovery and provider ownership

Payments remain **not live**. Dispatch now commits a recovery job before any
Stripe write. The existing scheduled worker retrieves known objects and can
discover a lost response using bounded, account-scoped Session/refund lists and
the saved operation identity. Discovery never posts money: a separate invocation
performs the full independent verification chain. Neither recovery path creates,
cancels or refunds. Missing, partial or ambiguous discoveries retain the hold.

Pending recovery survives the ordinary integration attempt limit. Rescheduled
polls yield to earlier due jobs, and the worker's platform duration covers its
existing work/cleanup budget. Creation switches do not disable recovery. Conflicting
signed/provider identities retain an irreversible review marker; duplicate ingress
does not poll that conflict away or append repeated revisions.

The unreleased 0128 migration now enforces reciprocal appointment ownership between
the workspace and closed SDK reservation. Transaction locks also prevent live
settlements, closed objects and deposits from adopting the same provider IDs.
The migration is absent from current origin/main and has never been applied to an
application database by this work. CI pins its new exact hash and requires all
53 native payment cases, with zero skips; previously shipped migrations stay frozen.

Validation: 84 provider/repository/outbox cases, 78 boundary/SDK/authenticated-route
cases, 41 worker/outbox cases (overlaps the first group), 53 native PostgreSQL
cases with zero skips, 28 CI contract checks, full TypeScript and the protected
surface gate. These are simulated provider tests against disposable databases.

Deposit checkpoint `28e37c9fe4e37bf21a360486afab1c1ad739488b` is pushed. Its Preview
`dpl_J5CX4oChN2uMx8uBoHrEqMcBMb3B` is READY and health reports expected
`gitSha=28e37c9`, still 503 for Connect/schema readiness. Its full Vitest aggregate,
three builds and native payment job passed; application/browser gates were still
running. The recovery checkpoint needs its own hosted build and checks.

Remaining release work: ready Canadian Standard sandbox connection, webhook and
status-signing configuration, verified target migrations, actual provider-backed
customer/technician payment/refund/return journeys, current-head CI/review,
protected-main merge and production verification. The configured test platform
has no connected accounts. Browser access remains disabled in Work settings.
Production and customer money remain unchanged.

## Previous checkpoint: deposit reconciliation and durable client refresh

Payments remain **not live**. Resolved full deposit refunds and forfeitures can
now update the workspace from canonical deposit facts without rewriting gross
payments or subtracting the same refund from other tender. The invoice and manual
tender baseline must still match. Pending, partial or ambiguous refunds stay held.
An authorized technician can refresh deposit credit; this action never calls a
Stripe write. History distinguishes refunded and forfeited deposits.

Payment settlement, manual tender and bill revision enqueue client-stat refresh
in the same transaction. The existing scheduled outbox retries failures and
evaluates the existing loyalty/fraud policy only for a completed, paid visit.
Deposit reconciliation and verified net-tender accounting remain active when new
payment creation is switched off. Existing deposit reward exclusions remain.

Validation: 170 focused accounting, provider-adapter, repository, outbox, UI and
existing deposit cases, including combined online and deposit refunds; 51 native
PostgreSQL cases with zero skips; full TypeScript, scoped lint and the protected
surface gate. Provider outcomes are simulated. The disposable database was removed.

Completed-bill commit `ccf5c208a9dbe5ffca426ba4cd9a2add281473b0` has a READY Preview
`dpl_FM5wkQfi7AQR79UT4DhScRxgWB6F`. Its return page responds 200 with private/no-store,
no-referrer and noindex headers. Health reports expected `gitSha=ccf5c20`, but remains
503 for Connect/schema readiness. Its full Vitest aggregate, all three builds and
native payment concurrency job passed; application and browser gates were still
running at this check. This uncommitted checkpoint needs its own hosted checks.

Remaining: scheduled payment recovery, reciprocal ownership safeguards, sandbox
provider and signing-secret setup, verified target migrations, actual provider-backed
journeys, current-head CI/review, protected-main merge and production verification.
No production, provider configuration, application database or customer money was changed.

## Previous checkpoint: completed-bill adjustments

Payments remain **not live**. Checkout and completed receipts now offer an explicit
Adjust bill action for enabled salons or retained payment history. An authorized
technician can add/remove catalog or custom items, revise prices/quantities and
record a reason. The editor retains the original completion instant, tax
configuration, exemption and tip. Saving never charges or refunds; the refreshed
Payments panel offers the additional balance or a separate original-payment refund.

The same appointment lock serializes revisions and new collections. Each change
requires a reviewed revision, invoice fingerprint and server-recomputed total,
with a stable retry identity. Active or uncertain money requests block revision.
The transaction retains original invoice/item evidence, writes the revised invoice,
updates payment status and appends immutable workspace history atomically. Deposit
excess and unsupported manual overpayment still require review. Existing checkout
item resolution is shared without changing its completion behavior.

Local checks: 122 editor/checkout/completion cases, 36 actual-route/provider and
repository cases, including completed additions/removals and unchanged tax settings;
51 native PostgreSQL cases with zero skips, including both revision-versus-collection
orderings; 28 CI workflow contract checks; and four desktop/mobile browser cases at
widths down to 320px. Full
TypeScript, scoped lint and the protected-file gate pass. Provider responses are
simulated; no application migration or real money movement has occurred.

Customer checkpoint `06847dd733b48a5994addd8165666c2e5e5fb78f` is pushed and its
Preview `dpl_8VFKoKbFyJ5yyQ4hkxSaKMmL7usz` is READY. The return page responded 200
with the expected private/no-store, no-referrer and noindex headers. Health remained
503 at `gitSha=06847dd` for missing Connect/schema readiness. All three hosted
builds passed. Its native payment job executed the expanded suite but failed the
old exact-count check of 47; this checkpoint pins all 51 cases, retaining zero skips.
The current completed-bill checkpoint still needs its own Preview and hosted CI.

Remaining: deposit-refund reconciliation, scheduled recovery, post-settlement and
bill-revision client/loyalty refresh, cross-family ownership, sandbox provider and
signing-secret setup, verified target migrations, actual provider-backed journeys,
current-head CI/review, protected-main merge and production verification.

## Previous checkpoint: customer booking and private payment initiation

Payments remain **not live**. Confirmed, deposit-free bookings can offer a
same-origin link to online payment options when the salon has enabled the feature
and its saved connection is ready. Existing deposit collection still runs first.
The private appointment page now displays the saved invoice, deposit credit,
remaining balance and cancellation/refund policy, with optional online payment.
Salons without opt-in keep their existing flow.

The public API derives a customer actor from the private booking capability and
rechecks its scope, expiry and revocation under the appointment lock. Customers
cannot edit invoices, record manual payments, request refunds or assume staff
powers. A payment requires the exact invoice fingerprint and policy revision the
customer accepted; those references are retained with the operation. Retrying a
lost response reuses its command identity. Browser amounts never set the charge.

Local validation: 212 booking/UI cases; 34 actual-route, repository and mocked-SDK
cases; 91 existing manage/accounting/authenticated-API regression cases; 24 inert
provider-boundary checks; 49 native PostgreSQL cases with zero skips, including
both orderings of capability revocation versus dispatch; and four desktop/mobile
browser cases. Full TypeScript passes. The 320px WebKit screen was inspected.
The owned disposable PostgreSQL cluster was stopped and removed. No real Stripe
charge, refund, account change, customer message or application migration occurred.

Return-status commit `3bfda8a78885a613c0966c07cbc00dfe039adfc1` is pushed. Preview
`dpl_B4EXyJ8oNdtjmzQSKTkQAtbSQtA2` is READY. `/payments/result?result=success`
returned 200 with “Checking your payment”, private/no-store, no-referrer and
noindex headers. Health is 503 at expected SHA `3bfda8a`, still missing Connect and
schema readiness. Its full Vitest aggregate, native payment job and all three
builds passed. Application coverage hit the full-tree boundary scan's five-second
timeout; this checkpoint gives that same unchanged assertion set a bounded
20 seconds. A browser job failed while installing OS dependencies in two bounded
attempts. New-head CI and Preview are still required.

Remaining: completed-invoice editing, deposit-refund reconciliation, scheduled
recovery, post-settlement client/loyalty refresh, cross-family ownership, provider
and signing-secret setup, target migration verification, actual provider-backed
customer/technician payment/refund/return journeys, then current-head CI, review,
protected-main merge and production verification. Browser access remains disabled.

## Previous checkpoint: verified customer return status

Payments remain **not live**. The customer return page now displays a minimal
server-verified payment result and confirmed refunds. Neither a success redirect
nor a Session-create response marks an appointment paid. Delayed confirmation
uses bounded polling, with an explicit refresh and clear instructions to contact
the salon before paying again. Status requests cannot create, cancel or refund.

An expiring signed capability is bound to one appointment, operation and return
origin. It stays in the URL fragment and is sent only in a same-origin POST body;
page/API responses are private, no-store and no-referrer. The signing-key hash is
frozen with the operation, so key rotation refuses a dispatch retry instead of
changing its Stripe idempotency parameters. Runtime activation now also requires
`CUSTOMER_PAYMENTS_STATUS_SIGNING_SECRET`: at least 32 random bytes encoded as
base64url, separately provisioned per environment. No secret has been provisioned.

Local checks: 87 token, runtime, API, provider, middleware, tenant and UI cases;
four desktop/mobile browser cases, including both engines at 320px. The SDK and
browser responses remain simulated; actual hosted Stripe return verification is
still required. Full TypeScript and scoped ESLint pass. The 320px WebKit
screenshot was also inspected; no horizontal overflow was observed.

Previous checkout commit `2bbb86ba91dd334451151aa0b7212d13a3561fe4` is pushed. Its
Preview `dpl_ta16ZuHZh59T4GEK23DBHkTcD795` reached READY. Home returned 200; health
returned 503 with expected `gitSha=2bbb86b`, `stripeConnectEnv=false` and
`schemaDrift=not_ready`. Hosted CI is running. This verifies the previous
checkpoint, not the currently uncommitted return-page changes.

Remaining work: customer booking/manage payment initiation, completed-invoice
editing, deposit-refund reconciliation, scheduled recovery, post-settlement
client/loyalty refresh, cross-family ownership, provider configuration and target
migration verification, real provider-backed payment/refund/return tests and the
current-head CI, review, merge and production checks.

## Previous checkpoint: technician checkout and canonical invoice revisions

Payments remain **not live**. Production, application databases, Stripe accounts and
customer money have not been changed. PR #504 remains a draft.

- The real CheckoutSheet now mounts Payments before completion and on the completed
  receipt, behind the server workspace flag and salon opt-in (or retained history). Staff can create/copy a secure link,
  check its result and close an old request. Refund details identify the original
  online payment and split service principal from tips; staff request owner approval.
  Lost responses retain the same command UUID. Unsaved edits block new financial
  commands, and an unresolved payment request blocks completion in UI and SQL.
- Completion, manual payment recording and manual voids join the existing appointment
  transaction and append a workspace audit revision. An added service leaves only
  the additional balance due. A removed service can create an overpayment backed by
  verified live online principal; it does not automatically refund or reuse tips.
  Deposit excess and historical synthetic capture restrictions still fail closed.
- Original invoice snapshots and payment allocations remain in immutable history.
  Manual voids are labeled corrections, not Stripe refunds. Failed later checkout
  work rolls back invoice, tender and workspace history together.
- The invoice reader refuses the older closed SDK reservation family. Cross-family
  settlement ownership and completed-invoice editing still need further work.
- CI failures at a806672 were the new migration count and missing owner-policy salon
  retention coverage. The inventory now pins all 129 migrations, and full salon
  deletion explicitly retains owner authorization history before any deletion.

Validated locally: 167 focused UI, actual checkout/API, invoice and provider cases;
35 migration/retention cases; 47 native PostgreSQL concurrency cases with zero
skips (the owned cluster was stopped and removed); four desktop/mobile browser cases including 320px
WebKit and Chromium. The browser checks use isolated HTTP fixtures, and provider
money responses are simulated. They do not establish a successful Stripe payment.

The a806672 Preview is READY at
`https://isla-nail-studio-5gl67724r-sniperstopsnipings-projects.vercel.app`.
Homepage 200 and health 503 with expected SHA a806672 were verified; health still
reports `stripeConnectEnv=false` and `schemaDrift=not_ready`. A new checkpoint
Preview must be verified after this commit. No feature switch has been enabled.

Still required before activation/merge: customer booking/manage/return integration,
editing an already completed invoice, explicit deposit-refund reconciliation,
recovery scheduling, post-settlement client/loyalty refresh and cross-family ownership
checks, sandbox account/webhook setup,
target migration verification, actual provider-backed payment/refund journeys,
current-head CI and preview/review gates. Browser access was disabled at the last
provider-console check; the earlier request to enable it remains pending.

## Previous checkpoint: owner activation and authenticated actions

Payments remain **not live**. The following is implemented on the release branch,
with no production merge, application migration, account activation or real charge.
Historical sections below describe earlier checkpoints, not the current API inventory.

- Separate owner opt-in (`0129_customer_payment_owner_activation.sql`), immutable
  revisions and retry receipts; test drafts cannot activate the feature. A saved
  activation binds the runtime mode, platform and exact connected-account generation.
- Owner settings UI under Settings -> Payments; explicit enable/save and cancellation
  policy, stable retry after a lost response, and a fresh read after saving.
- Authenticated `/api/appointments/[id]/payment-workspace` read and action API:
  initialize, request payment/refund, owner approve/reject, dispatch, refresh and
  cancel. It rejects client-supplied amounts/accounts/roles for payment requests,
  checks same-origin writes, and never treats a redirect or create response as money.
- Staff assignment, active employment and actual admin/owner membership are checked
  inside the appointment transaction, including retries. Impersonation is refused.
- Dispatch rechecks canonical invoice evidence and exact current activation before
  committing a lease. Disabling first blocks dispatch; a previously committed
  dispatch remains an existing request and must be reconciled. Undispatched requests
  can be canceled without assuming anything about Stripe.
- The API omits provider/account IDs from its browser projection and returns a
  transient Checkout URL only for the same currently open operation.
- Feature presentation/management requires `CUSTOMER_PAYMENTS_WORKSPACE_ENABLED`;
  provider writes separately require `CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED`.
  Neither environment switch nor any owner setting has been enabled by this work.

The a044b07 Preview was READY at
`https://isla-nail-studio-3ljn13kss-sniperstopsnipings-projects.vercel.app`.
The homepage returned 200; `/api/health` returned 503 with `gitSha=a044b07`,
`stripeConnectEnv=false`, and `schemaDrift=not_ready`. This confirms that checkpoint's
artifact, not payment readiness. Its three GitHub builds, full Vitest aggregate and
native payment job passed; the Application tests job failed from a TypeScript heap
OOM. The type-check step now requests the same 6 GiB heap as the successful builds.

Current validation includes 83 focused workspace, invoice, provider, activation,
API and settings cases plus 12 environment/history-projection cases (95 total),
28 workflow contracts, 42 migration/fixture checks, and 47 native PostgreSQL cases
with zero skips (two newly
added owner-disable/dispatch races). All provider money
outcomes in these local suites use simulated SDK responses. The native database is
real, isolated and disposable; its cluster was stopped and removed after the run.
Full TypeScript, lint (two pre-existing SettingsModal Fast Refresh warnings only),
commit lint and a 5,782-file tracked-tree secret scan passed for this checkpoint.

Still required before activation/merge: connect the technician action screen and
customer booking/manage/return journey, integrate canonical invoice edits,
completion, manual tender/voids and deposit refund changes with workspace revisions,
add recovery scheduling, finish sandbox account/webhook setup and target migration
verification, exercise the full provider-backed journey, and pass current-head CI
and preview/review gates. Browser access remains disabled; a user input request to
enable it is pending. Backend tests and a READY Preview are not a live payment test.

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

## November 11 authenticated sandbox checkpoint

The development owner now signs in through a normal Clerk session. A single-use
test sign-in token removed the password-reset blocker; organization creation,
email verification, canonical salon activation and the owner dashboard completed
through the Preview UI. No production identity or credential changed.

The synthetic salon `luster-payments-test` has an owned, ready Canadian Standard
test account. A bounded fixture connected the already-onboarded task account
after checking the exact Preview host and marker, the sole synthetic owner, zero
appointments and zero records in all 18 customer-payment tables. It retained the
incomplete UI-created binding as revoked history and added an audit record. This
is fixture setup, not proof of completing fresh Stripe onboarding end to end.
The ordinary owner UI independently refreshed Stripe readiness and saved online
payment activation and the synthetic refund policy.

A normal owner-created $50 Gel Manicure appointment reached checkout. Its first
payment-link request stopped at `PAYMENT_WORKSPACE_PROVIDER_SCOPE_MISMATCH`.
Stripe request `req_bfQnK7doK1iKYg` confirms HTTP 200 and API version `2024-06-20`
for the platform-authenticated connected-account lookup, with `Stripe-Account`
set to the connected account. The adapter incorrectly expected the platform ID
on that response. It now validates the connected account response identity while
keeping platform authentication and all other account/mode checks unchanged.

The positive regression failed before the correction. Afterward all 57 cases in
the provider, workspace repository and policy repository suites passed, including
foreign-header rejection before checkout creation. Scoped ESLint and full
TypeScript checks passed. The saved operation remains
uncertain with no payment recorded; the corrected Preview must retry that same
operation and verify its actual Stripe and ledger results. No charge or refund
has yet been completed. Current-head CI, financial journeys and production
release checks remain open; PR #504 is still draft and payments are not live.

Fresh CI then rejected the release-bot 1.152.0 dependency manifest pair inherited
from main. Both files match main exactly and differ from the previously reviewed
1.151.2 pair only in the three root version fields. The exact new blob pair was
registered without changing dependencies or weakening the guard. All 28 workflow
contract tests passed, including rejection of unreviewed and mixed pairs.

## November 11 first Stripe capture and duplicate delivery correction

The customer appointment page created a real Stripe sandbox Checkout session on
Preview `346d1ac8`. A 4242 test-card payment for CAD 50 succeeded. Independent
provider reads posted exactly one immutable settlement, one online tender and
5000 cents to the appointment's paid cache. No real money moved.

Stripe then redelivered the same `checkout.session.completed` event. Its signed
payload hash changed while all retained payment facts remained identical. The
repository incorrectly treated every second raw payload as conflicting evidence,
putting the already-paid operation into review and preventing checkout. The fix
retains both deliveries but compares event identity, mode, scope, API version,
object and payment facts rather than raw payload hashes or local receipt times.
Ingress, association and settlement now use the same conflict rule. Changed
amounts and other genuinely conflicting facts still hold the operation.

Both before-settlement and after-settlement redelivery regressions failed before
the fix. The corrected provider, repository and webhook suites pass 58 tests,
including exactly-once tender projection and changed-amount rejection. The earlier
false-conflict sandbox appointment remains held with its immutable evidence; it
has not been manually rewritten or presented as a passing end-to-end test.
Scoped ESLint and full TypeScript validation also pass for this correction.

The customer return page also encounters Vercel protection because its public
status request intentionally omits authentication cookies. A direct status API
check with the approved temporary Preview bypass returns the saved review state.
This is a protected-Preview test limitation, not proof of a working public return
journey. Fresh hosted payment, service changes, refunds, deposit and permissions
checks, final CI and the production delivery gates remain outstanding.
