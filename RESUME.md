# Twilio communications reliability — 2026-09-08

Branch: `codex/twilio-communications-reliability-20260908` from `origin/main` at `71f70ca`.
Worktree: `/Users/me/nailsalon-worktrees/twilio-communications-reliability-20260908`.

## Scope and safety

Repair the existing Twilio/communications system only. No broad product audit, production data mutations, real customer messages, automatic merge, or deployment. Preserve the original checkout and its user-owned changes. Node 20.19.4 and committed npm lockfile; test database is isolated PGlite, provider calls mocked.

## Checkpoint 0 — architecture audit

- Existing canonical storage: `communication_intent`, `notification_delivery`, salon `settings.communications`, shared consent/inbound tables and SMS credit ledger/reservations. Reuse them; no parallel inbox or billing system.
- Existing send paths diverge: shared sender dispatches intents; BYO and legacy `SMS.ts` send directly. Unify active appointment/manual sends through intents with mode-first sender resolution.
- Booking/request/approval/reschedule/cancel are incompletely wired. Pending bookings can use confirmed wording. Cancellation messages fail the dispatcher's blanket active-appointment check.
- Reminder reconciler can cancel overdue but unsent reminders; final dispatch lacks current state/contact/revision/settings/quiet-hours checks.
- Client Text opens a native Messages draft rather than sending through the configured Luster identity. Existing retention timeline records owner-marked outreach, not provider delivery.
- Usage/history reads intent status only, so later delivery failures appear sent. Retry must keep one intent/delivery and never resend ambiguous provider outcomes.
- Inbound BYO account-or-number selection is ambiguous; delivery callbacks need SID/account/service binding beyond signature verification.
- Integrations reflects old BYO/module readiness, ignoring shared sender, credits and actual communications preferences. Invalid settings can reset safety preferences.
- Inbound currently handles consent and metadata, not a two-way inbox. Preserve this scope and explain reply behavior honestly.

## In progress

1. Provider/dispatcher, sender safety, callbacks and inbound regression tests.
2. Booking lifecycle, reminders and deterministic disposable-salon journey.
3. Manual composer/send/retry/history using existing intents and delivery records.
4. Settings/Integrations readiness and focused UI repairs.
5. Targeted suites, typecheck, changed-source lint, appointment regressions, mobile browser checks where isolated prerequisites permit.

## Verification / release status

- `npm ci --no-audit --no-fund` succeeded with Node 20.19.4.
- No provider credentials copied into this worktree; no real messages sent.
- Final checks, remaining logical commits and provider-console runbook pending. No push, preview deployment, merge or production deployment has been performed.

## Checkpoint 1 — truthful settings and integration readiness

- Added server-resolved shared/BYO SMS availability, worker configuration, credits, sender label, and manual/automatic/reminder state.
- Settings preserves explicit pauses and disabled preferences when stored data is malformed; BYO legacy defaults apply only when canonical SMS settings are absent.
- Removed contradictory native-only manual-text messaging. Usage reads provider delivery state and only counts settled shared-credit sends.
- Existing SMS event storage is unrestricted text; added the `manual_text` TypeScript event without a database migration.
- Settings/Integrations/settings API focused checks: 273 tests passed; new operational SMS health/history checks: 11 passed. Owned-file lint has no errors (pre-existing warnings remain).

## Additional verification in progress

- Manual API/service tests: 9 passed; composer + client/appointment actions: 34 passed.
- Unknown-outcome refund + appointment sheet + booking-page isolated rerun: 91 passed.
- `npm run check-types` passed using repository-approved CI placeholders and Node 20. Initial attempts correctly failed closed on incomplete environment markers; no guards were bypassed.
- First full suite during active migration: 630 files passed, 12 failed, 17 skipped; failures exposed obsolete direct-send expectations, token churn, and component test timing. Repairs and full rerun required before handoff.
- Disk filled during local browser verification. Stopped own browser/server, ran `npm run clean` in this task worktree, and replaced this task's fresh dependencies with a symlink to an existing installation only after verifying every dependency lock entry matched. Recovered 1.6 GiB without deleting user caches or changing the original checkout.
- Disposable browser data is `/tmp/luster-sms-lab-20260908`; server stopped. No real provider calls. Full browser journey not yet verified.

## Checkpoint 2 — provider, delivery, callbacks and recovery

- One `messages.create` seam with bounded timeout, SDK retries disabled and explicit rejection versus uncertain outcome handling. No fallback onto a different texting identity.
- Shared/BYO dispatcher checks current settings, quiet hours, tenant/client/appointment state and contacts before provider invocation. Delivery evidence and transition to sending are atomic; rejected retries reuse the delivery record and ambiguous outcomes retain their credit hold.
- Signed inbound/status/deauthorization requests bind known account identity. Known connected-account signing tokens can be fetched with existing Connect authorization and held briefly server-side; no token is stored or logged. Missing access fails closed.
- Callback replay resumes idempotent refunds after interruption. Unknown-outcome adoption settles evidence and refunds an already-undelivered message once.
- Provider scope: 90 targeted tests passed; focused lint clean. Unknown-outcome resolver: 4 passed. No real Twilio API calls made during tests.

## Checkpoint 3 — appointment lifecycle, reminders and owner texting

- Appointment creation, request approval, deposit confirmation, private-link cancellation, expiry and reschedule persist canonical SMS events inside the business transaction. Instant bookings are stored as confirmed; explicit requests remain pending with matching wording.
- Replaced the separate direct-send reminder worker with canonical reminder rules. Current timezone, lead time, contact, rule/settings revision and appointment state are checked; old reminders are invalidated and concurrent workers cannot duplicate provider calls.
- Added tenant-authorized manual text/history/retry API and composer to existing client/appointment actions. Current canonical contact and appointment ownership are resolved server-side. Lost-response replays observe the original intent before mutable readiness checks; safe rejected retries reuse the original delivery.
- Explicit reminder resends carry an action key; ordinary repeated clicks retain deterministic dedupe. History separates provider delivery from owner-recorded native outreach.
- Final dispatcher checks also reject changed reminder rules, inactive salons and revoked BYO connections, with readable failure reasons.
- Lifecycle targeted verification: 12 suites / 259 tests passed. Manual queue-to-provider/tenant/contact/quiet/retry tests: 8 passed. Manual route: 6 passed. Dispatcher followup/email checks: 25 passed.
- Real PostgreSQL 16.15 verification: dispatcher concurrency 5/5 and SMS credit concurrency 9/9 passed against a new explicitly disposable localhost cluster. Provider mocked; cluster stopped and removed. Logs: `/tmp/luster-sms-pg-dispatcher-20260908.log`, `/tmp/luster-sms-pg-credits-20260908.log`.
- Production build passed with approved synthetic CI configuration and no external database/provider credentials. Task build artifacts cleaned afterward to restore scarce local disk space.
- Secret scan initially refused an unstaged tracked-file deletion; rerun after staging/commit is required. It did not report a credential value.
