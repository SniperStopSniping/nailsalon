# Owner organization, Today and Calendar Block Time

## Release scope

This release implements the accepted owner organization and Today recommendations on top of #271. It adds one capability: exact intraday Calendar blocks. It does not change review automation settings, reminder schedules, billing activation, AI authority, or payment calculations. The RT-20 billing issue remains a separate repair.

Bottom navigation remains **Today · Calendar · Clients · Services · More**.

Today is an operational briefing: urgent appointment decisions; authoritative in-progress appointment, otherwise earliest future confirmed appointment; remaining appointments; New Appointment / Walk-in / Message Client; actionable attention; compact Completed service revenue using the existing financial reporting service; a Clients follow-up summary; collapsed utilities. Pending requests and payment holds are never the next client. Past-ended confirmed/pending appointments need an update, not an inferred completion. Empty gaps are never advertised as available.

More keeps Booking (Hours & Availability, Booking Rules & Policies, Booking Page), Clients & Growth (Marketing & Messages, Portfolio), Business, then Luster. Business is **Team → Analytics → Payments → Integrations** for teams and **Analytics → Payments → Integrations** for solo salons. Settings contains Account, Owner & Staff Alerts, Appointment Photo Rules, and Advanced (Optional Features, Legacy Page Themes, conditional section preview). Existing compatibility routes remain.

Clients owns Insights & Follow-ups; Marketing and Today link there. Services exposes My Menu and Add-ons first, with Library and Advanced Catalog under More options. Marketing combines six/eight-week configuration under Win-back Offers, names Appointment Messages & Reminders and Review Requests explicitly, and puts Results after operational destinations. Booking Page uses What Clients See and Booking Messages & Social Links. Payments owns Stripe & Payouts; Integrations reports connection state and links to it. Team schedules and Days Off link to canonical Hours & Availability. Photo-rule failures link to the canonical rules in a separate tab so the appointment stays open.

## Block Time contract

Calendar → Block Time creates, edits and removes a technician's exact interval on one salon-local date. Solo salons do not see a technician selector. It is distinct from recurring working hours, whole/multi-day Days Off, and external Google busy events. Labels are internal. An overlapping appointment, its buffer or another block is refused. Removing a block does not override any other availability rule.

The existing availability engine reads the saved absolute interval, as do Smart Fit and Owner Assistant's availability explanation. Booking writers and block mutations share technician locks and a tenant-scoped revision row. The revision row makes stale SERIALIZABLE snapshots retry rather than proceed after an advisory lock alone. Reassignment locks both technicians in stable order. Reason-only edits cannot rewrite stale appointment status. Late-deposit recovery treats a block conflict as the existing lost-slot reconciliation outcome; refund policy and provider idempotency remain unchanged.

Malformed dates, nonexistent DST times and ambiguous repeated-hour endpoints are rejected. Blocks do not send messages, create bookings or change payment state.

## Reviewed migration

Only `0085_calendar_intraday_blocks.sql` is new. SHA-256:

`3f6eecda4b285df784027cddd2b92ba46207503ff446f19457378bf8a9549e86`

It adds nullable `starts_at` / `ends_at` to `technician_blocked_slot`, an exact-window index/check, and `technician_schedule_guard` with a composite tenant/technician foreign key. Existing blocked rows remain unchanged. There is no data backfill, setting activation or alteration to migrations 0081–0084. The journal and snapshot append to 0084.

## Guarded Production order

1. Require exact-head CI, Preview/build checks, resolved review conversations and independent safety review. Record the reviewed head and checks before mutation.
2. Reconcile continuity against the prior successful 0080/#271 attestations: Neon project `raspy-dust-88266097`, production branch `br-lucky-shape-a4fizifo`, database `neondb`; current provider metadata; exact ledger hashes; deployed schema readiness; repository expectations. No DATABASE_URL disclosure is necessary. Any conflicting identity or unexpected migration state stops release.
3. Create a fresh Neon recovery snapshot of that source branch. Verify source identity and completed operations; record snapshot id/time. Do not substitute an old snapshot or an unverified creation response.
4. Verify ledger through 0084 exactly and 0085 absent, verify reviewed SQL checksum, then invoke the established guarded Production migration command from the reviewed source. Apply only 0085. Verify exact ledger count/hash/time, columns, constraint, index, guard table and composite FK. Do not bypass migration/environment guards or log credentials.
5. Merge through protected main and deploy the reviewed implementation through the normal validated Production process. Verify deployed SHA/tree, aliases and health/schema readiness. A release metadata-only commit must be distinguished from code drift.
6. **Do not save any live Block Time until compatible code is fully promoted and old booking writers have drained.** Old code ignores exact blocks and the new guard. Do not allow an old deployment to serve normal booking traffic once real blocks exist.
7. Verify owner navigation/legacy URLs, Today, Calendar, Hours, Review Requests, manual booking and Customer AI handoff without submitting a real booking; Owner Assistant destinations; reminders unchanged; review settings unchanged; no release-triggered messages/payments; billing dark. Use disposable fixtures for block mutation and race tests.

## Recovery boundary

Before any exact block exists, the additive schema can coexist with old code. After the first live exact block, rolling back to pre-0085-aware application code is unsafe because it can book over the block. Prefer a compatible fix-forward. A rollback at that point requires preventing all booking writes and an explicitly reviewed recovery plan. Never automatically restore the snapshot over subsequent live bookings, payments or customer changes. Preserve the snapshot, all original #271 worktrees/heads and release evidence.

## Verification evidence to attach

- Tenant-scoped route validation, optimistic versions, duplicate create, overlap/buffer, invalid/DST time and editor tests.
- Real PostgreSQL 11-case block/booking concurrency gate, including both commit orders, READ COMMITTED/SERIALIZABLE and tenant FK checks; CI requires zero skipped cases.
- Authoritative Owner Assistant availability tests with an actual exact block; Customer AI legacy/L1 browser journeys on PostgreSQL and synthetic providers; manual/normal booking parity.
- Appointment/reminder regression, existing financial/review tests, complete Vitest suite, type check, lint, secret scan and builds.
- Chromium/WebKit 320px and enlarged-text checks, keyboard/focus/back behavior, safe areas, 44px targets, reduced motion. Record any browser-host limitation accurately.
- Final Production evidence (identity continuity, recovery snapshot, migration postimage, deployed SHA, health and read-only smoke checks).

This document specifies release gates; their presence is not a claim that Production rollout has occurred.
