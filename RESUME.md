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
- Final checks, logical commits, preview/PR and provider-console runbook pending. Protected main will not be merged or deployed automatically.
