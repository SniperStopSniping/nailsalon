# AI setup: team schedules and service assignments

This checkpoint extends the existing owner-reviewed setup draft, not the scheduling engine. It is local development work on `codex/ai-business-setup`, following `1c009d04`. No hosted or production deployment, production migration, payment, outbound message or billable AI call was made for this checkpoint.

## What owners can do

- Describe supported team names, weekly schedules and service choices in the existing business-and-website conversation. Website-only and price-only scopes cannot change staff.
- Make the same corrections in Details. Existing schedules are retained unless explicitly edited; a later name change cannot discard an earlier schedule proposal.
- Inspect proposed team schedules and service eligibility from Preview, including custom website previews, and see readable before/after details at review.
- Approve the exact revision and publish into the existing Luster technician and technician-services records. No staff account, invitation, pay setting or appointment is created by adding a team profile.
- Reset and restore without duplicating staff or services. New sessions have distinct identity lineages so a model's reused short draft identifier cannot overwrite an older published person or service.

Ordinary booking continues through Luster. A supported service selection is validated against real published service and technician identities. Preview availability uses the existing availability engine with proposed schedules; appointments, time off and external calendars are explicitly excluded from its simulation. Preview cannot create appointments.

## Implementation and boundaries

- `contracts.ts`: bounded, strict `staff` actions; names, active status, seven-day hours and service IDs. New people require draft identities and explicit service choices. Upload extraction cannot silently create staff. Unsupported compensation, login, staff-specific price/duration or invite fields are rejected.
- `staff.ts`: allowlisted staff projection using the application's weekly/legacy schedule resolver. No staff contact details, compensation or internal notes enter the conversational draft.
- `TeamEditor.tsx`, `TeamBookingSummary.tsx`, `team-summary.ts`: manual corrections, truthful preview details and plain-language review. Controls stay out of the default chat screen.
- `drafts.server.ts`: immutable revision read adapter for older JSON, shared draft edits, exact-review hashing and safe restoration. Internal identity and eligibility metadata are excluded from the displayed changes, while still included in the approval hash.
- `staff-publication.server.ts`: updates only supported staff fields and reviewed service assignments. Other fields and assignment priorities are retained. Intentionally unassigned services receive disabled junction rows, so legacy fallback cannot silently reactivate them. Omitted staff and services are never deleted.
- `publication-identities.server.ts`: resolves temporary identities only within the authorized salon, setup and identity lineage. Ambiguous receipts and unsafe older restores fail with a recoverable explanation.
- `publish.server.ts`: locks canonical catalog, location, staff and assignment rows before checking the baseline. This catches changes from older manual routes that do not acquire the salon lock. Publication receipt, staff, services and website configuration commit atomically; duplicate requests replay the receipt.
- `0109_setup_staff_publication.sql`: additive `staff_ids` map on publication receipts, with an empty default for existing rows. No rewrite of historical draft documents, approvals or appointments. The exact new SQL and journal tag are pinned in CI.

Before enabling the first explicit assignments on a legacy team, the owner must review each active person's eligibility. Current Luster plans all permit staff profiles; the feature does not change commercial pricing or staff limits. Existing appointment rows and booked-service price/duration snapshots remain untouched, including appointments outside a newly approved staff schedule. Review explains that the owner must arrange any needed customer changes themselves.

Existing-business opening-hours changes remain blocked until the appointment-impact path is completed. This pre-existing restriction is now visible during review, before approval. Existing-business currency/time-zone changes retain their server guard. Deposits, cancellations and reminders are not expanded by this checkpoint, and a proposal does not activate an external payment or notification feature.

## Evidence

- 158 deterministic tests: 117 setup/custom frontend persistence regressions; nine team integration cases; 28 owner builder cases; four manual team/summary cases. Real PGlite database and production domain functions; injected fake model responses, no OpenAI call.
- 18 real PostgreSQL cases on the attested disposable loopback database: nine publication/concurrency cases, seven credit-wallet/metering cases, two account-entry races. Zero skipped. Includes duplicate team publication, a concurrent older manual staff update, transaction rollback and lost-response receipt replay.
- 15 browser cases across desktop Chromium, phone Chromium and iPhone WebKit: 12 existing credit-interface cases plus three team save/refresh/preview/review cases. Production components with synthetic API responses; these are component browser tests, not real checkout or full customer-booking acceptance.
- 18 native CI contract checks; `npm run check-types`; scoped ESLint and whitespace checks. Provider/Stripe calls remain separate release gates.

The first browser run's three new cases failed because the test locator matched both a hidden preview paragraph and the visible review paragraph. Scoping the assertion to the review region fixed the test; all three reran successfully without application changes. The first team scope assertion expected the wrong existing error code and was corrected to `INVALID` while retaining the no-write assertion.

Screenshots (synthetic data) are in `artifacts/ai-credits/team/`, with separate desktop, phone Chromium and iPhone WebKit preview/review images. These show saved team details, not newly model-generated website evidence.

Remaining release work includes existing-hours/policy prerequisites, a friendly first booking URL, a genuine workflow recording, paid real-provider owner journeys, Stripe sandbox acceptance, independently isolated hosted Preview and required remote CI/review gates. The full AI builder is not declared complete by this checkpoint.
