# Rebooking Reminders release

Rebooking Reminders is a separate, default-off automatic SMS feature under Marketing & Messages. The existing confirmation-page Rebooking Prompt, manual Win-back Offers, and messages for already-booked appointments retain their own settings and behavior.

## Scheduling and delivery

- A completed appointment from before enablement can qualify if its scheduled reminder date is on or after enablement. Earlier reminder dates do not trigger a backlog.
- The salon default is three calendar weeks after the local date of completion, at 10:00 a.m. in the salon's booking timezone. The schema also supports per-service week overrides; the owner UI currently edits only the salon default.
- The worker selects the latest completed appointment for an active client. It excludes cancelled, no-show, deleted, blocked, archived, and merged client records, and clients with a live upcoming booking. It checks again before the provider call.
- Rebooking uses the existing `communication_intent` queue, `salon_promotions` SMS eligibility, quiet hours, sender readiness, segment-based credit reservation, provider outcome handling, and delivery records. A unique dedupe key based on salon and completed appointment prevents another reminder for that appointment.
- The configured message is rendered from the latest saved template at dispatch with the standard salon prefix and STOP footer. The preview shows sample values and estimated SMS credits; actual values and credits are recorded by the dispatcher.
- A due reminder expires seven days after its scheduled time. The cron runs every five minutes through the existing `/api/communications/dispatch` route. Materialization runs after the established dispatch and review work, so a newly queued reminder normally sends on the next tick.

## Release sequence

1. Apply migration `0096_rebooking_reminders` to an approved Preview database through the guarded Preview command, then verify the Preview application and required PR checks. Keep the automation disabled until the migration is verified.
2. Before merging the application PR, apply `0096_rebooking_reminders` to Production through the guarded Production command and verify the migration ledger and both tables. Production requires the verified backup and `LUSTER_PRODUCTION_CONFIRM` controls documented in `README.md`; migrations do not run during build or deployment.
3. After required CI, Preview, and review gates pass, merge the PR and deploy the matching application SHA from protected `main` through the existing Git deployment path.
4. Verify `/api/health`, the Marketing & Messages card and settings read/write in the intended salon, and the cron result. Confirm no reminders are queued before an owner enables the feature. Use a disposable or explicitly approved test recipient to verify a provider delivery and credit settlement; a queued intent alone is not a delivered SMS.

No production migration, owner enablement, provider send, or deployment is performed by adding this code.
