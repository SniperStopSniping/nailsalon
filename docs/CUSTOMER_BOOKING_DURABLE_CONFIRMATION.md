# Customer booking confirmation (dark)

This supersedes the incomplete-review and handoff-only sections of
`CUSTOMER_BOOKING_ASSISTANT_IMPLEMENTATION.md`. The customer pilot remains off.
The reviewed proposal, availability and contact stages are preserved. The SMS
contract merged in #245 remains the only appointment-reminder authority.

## Customer journey and authority

The model interprets a bounded public-menu request. Luster validates compatible
services/add-ons and renders the proposal. The customer accepts it, requests a
day/time, selects a freshly checked slot, and supplies name, email and required
phone outside the model conversation. The visible reminder control follows the
salon's `default_on`, `default_off` or `disabled` setting. An untouched checkbox
remains `default_on`; changes become `explicit_off` or `explicit_on`.

Review preparation re-reads public location presentation, menu names and
quantities, price, duration, identity-dependent discounts, Smart Fit, tax,
deposit disclosure, approval policy, and reminder preference. Unknown or changed
authority fails closed. The final card uses these server values, never model
prose. “Any available artist” is an explicit selection; the committed status
resolves the assigned technician. A slot is not held by review preparation.

Only the deterministic **Confirm booking** action calls the public booking
engine. `POST /api/appointments` and the assistant share
`appointmentCreation.server.ts`; the assistant supplies a server-only anonymous
authority that cannot inherit an owner/staff cookie. The engine repeats its
ordinary booking rules and additionally validates the accepted material inside
the customer operation transaction. Current schedules, overrides, time off,
blocked slots, public location, service eligibility, prices, tax, policies and
reminder mode are re-read on that transaction. A stale review creates nothing.

The returned status distinguishes payment required/processing, awaiting salon
approval, confirmed, in progress, completed, cancelled and unavailable. Neither
a model response nor a payment redirect can establish confirmation. Linked
bookings replace the review/contact/Confirm controls with the status card.

## Durable operation and recovery

Migration `0080_customer_booking_operation` adds one table. Its unique
`(salon_id, session_id)` identifies one customer operation. Review revisions use
compare-and-set under a row lock; the material fingerprint includes a
domain-separated HMAC of normalized contact. The record contains no raw contact,
transcript or bearer capability. Review acceptance lasts five minutes; recovery
lasts 100 days. Rotation of the dedicated signing secret requires a deliberate
recovery plan; it is not an ordinary way to disable the pilot.

Confirmation locks the operation before client/appointment writes. The shared
creator uses serializable transactions for this authority, existing technician
locks and overlap constraints, and its existing retry rules. It links the
appointment or deposit hold in the same commit. A reviewed reward is bound as
pending redemption in that commit as well. The manual booking transaction path
retains its existing behavior.

An operation's appointment identifier deliberately has no appointment FK: a
deleted appointment leaves a tombstone and can never reopen the operation for
creation. Salon deletion cascades the operation itself. Recovery is scoped to
the stable salon ID, so a renamed slug or disabled conversational feature does
not invalidate an already-created booking's recovery authority.

Before sending Confirm, the browser must successfully persist and read back only
the opaque operation reference. Double taps, lost responses and explicit retries
keep that reference. After ambiguity it reads the original status before another
attempt. Refresh recovers the same reference and, if uncommitted, recollects
contact in memory for the original operation. It does not start a replacement
session while the outcome is unknown. A definite slot rejection returns fresh
alternatives; review changes require renewed acceptance.

Capability-authenticated status reads do not call a provider, send recovery
email or mint management links. The explicit Manage action derives one stable
guest link and preserves its original expiry/revocation. It does not use owner
authority. All recovery endpoints require same origin, bounded strict input,
tenant-bound capability verification and no-store responses.

## Deposit and reminder integration

The existing appointment/deposit transaction, immutable Stripe account/amount/
return URLs, checkout idempotency key, hold deadline and reconciliation remain
authoritative. No card details enter chat. An ambiguous checkout create leaves
the original hold linked to the operation. Resume retrieves that session, or
replays the original create with the same key and parameters. It shares the
existing durable recovery budget and never extends the hold. Learned paid
evidence goes through `confirmDepositPayment`; stale unpaid evidence cannot
clear an already-recorded payment intent. No new billing webhook, subscription,
product, price or billing activation is involved.

Confirmation feeds the original canonical reminder payload through the public
engine. Its consent event records default/explicit provenance. Prior STOP,
provider suppression and salon disabling retain precedence; no second consent
store or marketing consent is introduced. Status reads use the same appointment
SMS preference helper as manual bookings.

## Verification and rollout

The new PostgreSQL suites refuse non-disposable targets and attest the live
server before migrations or writes. CI requires explicit execution sentinels;
ordinary unit runs may skip these suites only because the dedicated database
gate runs them separately. Cases exercise actual public creation, concurrent
operation/slot claims, lost responses, stale review rollback, returning-client
identity, add-on snapshots, canonical SMS provenance/STOP, and original deposit
recovery. Provider transports are synthetic: no real message or payment is
required or authorized by these tests.

The browser journey bridges the fixture's requests to actual public handlers and
the disposable PostgreSQL authority. Its model transport and Redis quota are
substituted and explicitly do not prove live provider or hosted Redis readiness.
Component-only screenshots are separately named from actual-backend screenshots.

Before enabling Isla, verify the exact merged deployment, migration 0080 and
its indexes/constraints on the intended database, a dedicated
`OPENAI_API_KEY_CUSTOMER`, a stable `CUSTOMER_ASSISTANT_SIGNING_SECRET` of at least
32 characters, customer Redis budget/replay readiness and usage monitoring.
Use the guarded database runbook and verified backup for a Production migration;
never migrate during build. Inspect pending migrations first: this feature is
not authorization to apply unrelated billing migrations to Preview.

Keep `CUSTOMER_ASSISTANT_ENABLED` unset/false during rollout. A separate explicit
authorization is required to set it true; the existing exact Isla pilot gate
then admits only `isla-nail-studio`. Verify Isla's supported public catalog,
phone/reminder setting, approval/deposit policy and tenant-specific calendar
configuration before activation. The existing L1 and legacy-calendar fail-closed
limitations remain; do not bypass them for the pilot. Disabling the conversational
switch stops new AI sessions/creates while stable-ID booking recovery remains
available with the existing signing secret.

## Local release evidence (2026-09-18)

- PostgreSQL: 8 operation-store and 17 actual-creator cases passed, zero skips.
  Includes concurrent same-operation calls, simultaneous slot claims, ambiguity
  recovery, returning-client identity, STOP and default/explicit reminder states,
  stale quote/policy/location/schedule rollback, reward claim, and deposit retry.
- Actual-handler browser journey: Chromium and WebKit both created exactly one
  synthetic no-deposit appointment on disposable PostgreSQL. Model/Redis quota
  and message/payment transports were substituted; this is not live-provider proof.
- Appointment regression: 103 passed. Manual confirmation browser coverage:
  33 passed across desktop Chromium, mobile Chromium and WebKit.
- Full local suite: 744 suites passed; 10 failed on new migration/extraction
  assertions or resource-contention timeouts. After focused corrections, all
  10 previously failing suites passed (205 tests). Exact-head CI is the full
  release gate; this record does not describe the initial full run as green.
- Synthetic model evaluation: 24/24 structurally valid, allowed-menu outputs;
  21/24 strict scenario expectations. Friday-to-Saturday and later/after-five
  follow-ups passed. Three conservative mismatches remained: service clarification
  before time, refusal of an injected owner-tool request, and clarification of an
  invalid date. Latest run cost $0.010582, median 1.895 s, p95 3.393 s. These
  mismatches do not bypass deterministic validation or create authority.
- Independent read-only high-risk review found recovery UI and rejection-message
  issues; fixes have regression coverage. No other blocking finding in reviewed
  operation, tenant, payment or manual-path boundaries.

Screenshots in `artifacts/customer-assistant/actual-backend-*-confirmed.png`
show actual disposable-database results. Other `synthetic-durable` screenshots
exercise the component harness. Neither is a Production booking.

Migration 0080 has been applied only to the disposable test database during this
work. Hosted migration and provider/Redis readiness remain activation prerequisites;
a dark code deployment is not evidence that those activation steps are complete.
