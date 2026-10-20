# AI setup: opening-hours review and booking agreements

Local checkpoint following `478f196e` on `codex/ai-business-setup`. No deployment, production migration, production-data change or billable model call occurred in this phase. The fully custom frontend generator and renderer remain in place.

## Owner behavior

Owners can prepare opening-hours changes, supported appointment-time intervals and confirmation settings, and an appointment agreement in the shared draft. Chat and Details use the same validated configuration. Website-only and price-only conversations cannot change the agreement or other booking rules.

For an existing business, reviewing a schedule change shows the number of upcoming appointments, those outside the proposed opening/staff hours, and those involving staff whose availability or service choices change. Existing appointments remain as booked. If the change affects existing appointments, the owner must explicitly acknowledge that before approval. Calendar changes after review or approval require a fresh review; approval does not silently carry over.

An approved booking agreement becomes the original Luster confirmation agreement. Required acceptance uses the existing server-generated policy version and acceptance records. Drafting the agreement does not send an email, collect a deposit, charge a fee, or activate an automatic cancellation deadline. `clientChangeCutoffHours` is a retained legacy field that does not block customer changes; the assistant explicitly avoids describing it as enforcement.

Publishing an existing salon's website/settings preserves its disabled-online-booking choice. First-time publication of an unpublished salon still enables its original booking flow after owner approval.

## Implementation

- `appointment-impact.server.ts` reads only authorized appointment IDs, staff/location identities, times and operational status, using the existing slot-blocking predicate. It never reads names, phones, emails or notes. A bounded review checks proposed hours in the saved business time zone and accounts for blocked duration. Explicit secondary-location hours stay independent from primary-location updates.
- `reviewSetupHead` binds the approval hash to that operational footprint; `approveSetup` requires explicit acknowledgment where needed. Audit records retain counts and the fingerprint, not customer details. The existing salon lock and the original booking financial fence serialize setup publication against new bookings.
- `AppointmentImpactReview.tsx` binds its checkbox to the exact review hash. Editing the draft or loading a newer calendar review clears effective consent.
- `publicBookingCommitAvailability.server.ts` closes the ordinary browser booking race by reloading published business hours, staff schedules, service eligibility and reviewed service values inside the existing serialized booking transaction. It invokes the original booking-policy/availability code. Admin calendar entries and existing reschedules retain their established paths. No new scheduling engine, booking form or appointment database was introduced.
- `booking-policy.ts` reuses `bookingPolicyUpdateSchema`, strips derived versions and resolves them only through Luster's canonical policy resolver. Older saved projections retain their current acceptance configuration rather than treating an omitted field as permission to weaken it. Historical revisions are not rewritten.
- `BookingPolicyEditor.tsx`, `contracts.ts` and `conversation.server.ts` add bounded draft agreement edits and manual controls. Existing agreement/acceptance text is reused. Required acceptance retains the existing required-implies-enabled/before-confirmation invariants.
- `SetupPreview.tsx` adapts proposed policy settings into production components. Custom previews already receive the shared draft's booking-rule data. Publication writes the policy only when included in the draft change, preserves unrelated settings, and rechecks private-address wording before committing.

No new database migration is needed for this phase: the additive fields use the existing versioned JSON draft. Owner authorization, salon isolation, idempotent publication receipts and canonical temporary-ID mappings are retained.

## Verification

- 184 focused deterministic cases across the setup/custom frontend persistence, staff, agreement, owner editor, API boundary and appointment request suites. Model responses are injected test doubles; these results do not claim real AI generation.
- 49 actual original-booking PostgreSQL cases on the attested disposable loopback database, with zero skips. The complete new case prepares a draft while live hours remain unchanged, reviews/acknowledges an existing appointment outside the proposal, publishes/replays safely, rejects new bookings on the closed day, reopens hours, completes a new original booking, and then publishes/tests a required customer agreement. Historical appointment and booked-service snapshots are preserved.
- Four additional race cases change business hours, staff schedules, staff eligibility or service price after browser preflight and before the real booking transaction. Each creates no appointment. External email/SMS/payment/calendar providers are blocked or mocked.
- 18 existing PostgreSQL concurrency cases cover publication, prepaid credits and new-account entry. Separate setup persistence cases reject calendar changes between review/approval and approval/publication.
- Three browser cases cover desktop Chromium, phone Chromium and iPhone WebKit using the production owner components and synthetic API responses. They verify saving, refresh/resume, proposed staff details, before/after review and the required acknowledgment. These are component browser tests, not a real-provider owner-to-customer acceptance recording.
- Type generation/TypeScript, scoped ESLint, whitespace checks and the 18 native CI-contract tests are required for this commit. The remote CI gate now requires all 49 booking-authority cases rather than its former 43.

The expanded integration fixture initially left its newly configured city in the shared synthetic account, invalidating later prepared-location fixtures. Resetting that synthetic field fixed the test isolation. A closed-day preflight correctly returns the original `OUTSIDE_SCHEDULE` response (400); a change racing the commit returns a conflict (409). The tests assert each actual behavior rather than substituting a booking-success mock.

Viewable synthetic owner screenshots are retained in `artifacts/ai-credits/team/`, including the updated appointment-impact review on mobile.

## Remaining release work

Continue the same implementation with supported deposit/reminder prerequisites, a friendly first booking URL, existing catalog pricing/options coverage and new-business timezone verification. Then exercise the paid owner workflow with actual model output, retain the required design/reference/revision evidence and record the real walkthrough. Stripe sandbox purchase acceptance still awaits the test key the owner chose to add later. Hosted Preview isolation, remote CI/review and the gated production release remain outstanding; this checkpoint does not declare the complete builder finished.
