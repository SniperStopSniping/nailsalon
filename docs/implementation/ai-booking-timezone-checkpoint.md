# AI setup: salon-local booking hours checkpoint

This phase extends the existing booking engine. It introduces no new scheduling system, external service or database migration. It has not been deployed.

## Owner and customer behavior

Private setup previews and the original customer booking path now interpret staff hours, business hours, overrides and recurring breaks in the salon's saved booking timezone. New appointments keep their exact UTC instant. Moving an appointment uses the same local hours and preserves its booked service duration and price.

Whole-day time off includes the final date displayed on the owner calendar. Legacy specific-date breaks use the stored calendar date rather than shifting midnight into the previous day. Exact intraday block instants remain exact, independent of timezone.

Skipped spring-forward starts are omitted from availability and rejected by the appointment API when supplied as a local date/time. A repeated fall-back start is offered once with a deterministic exact instant. Calendar-day iteration in preview and next-available search no longer assumes that each local day lasts 24 hours. This does not introduce overnight-shift support or change the existing schedule format.

## Implementation

- `src/libs/bookingPolicy.ts`: optional timezone inputs retain Toronto as the legacy default. Weekdays and wall-clock schedule comparisons use the existing time helpers without host-local Date conversions. Whole-day records match the canonical requested date used by schedule overrides.
- `src/libs/availability/engine.server.ts`: both the visible and actual availability passes receive the same timezone. Nonexistent local starts cannot become phantom or duplicate slots.
- `src/libs/appointmentCreation.server.ts` and `publicBookingCommitAvailability.server.ts`: preflight and serialized commit validation use the salon timezone; the booking date is derived in that zone. The reviewed anonymous-booking path retains its existing configuration/approval checks.
- `src/libs/appointmentManage.ts` and `smartFitBooking.ts`: rescheduling and Smart Fit work windows use the same local calendar and original eligibility engine.
- `src/features/business-setup/preview-data.server.ts`: proposed timezone and calendar dates flow into the original engine. Preview remains simulated and cannot create appointments. Editing a timezone draft does not modify live business settings.
- `src/libs/ownerAssistant/tools/diagnoseDayAvailability.server.ts`: the former Toronto-only refusal is removed now that its underlying engine supports the configured zone. Its identity-free read boundary remains enforced.

## Verification

- 360 distinct deterministic cases passed across 11 suites. This includes setup persistence/private-preview isolation, Toronto byte-parity snapshots, availability and import boundaries, time conversion, Smart Fit, request approval, appointment request validation, rescheduling and owner day diagnosis. These tests use injected model/provider responses where relevant; they are not real-AI acceptance trials.
- All 55 original-booking PostgreSQL cases passed on the attested disposable loopback database, with zero skips. Six new cases cover ordinary Vancouver evening booking and closed-day rejection, reviewed anonymous Vancouver booking, Tokyo recurring breaks/specific-date breaks/whole-day time off followed by successful booking after removal, and rejection of a skipped daylight-saving wall time. External messages, payments and calendar requests are blocked or mocked.
- The PostgreSQL CI gate requires exactly 55 executed cases and zero skips. All 18 native CI-contract tests passed.
- Type generation/TypeScript, scoped ESLint and whitespace checks passed. Secret-tree scanning is required before committing.

The wider regression run exposed two fixtures that relied on the former timezone behavior. The override snapshot fixture now ends its Friday vacation on Friday, so Saturday independently tests the hours override; the snapshot itself is unchanged. The UTC request-approval fixture now chooses an appointment within UTC working hours. A setup-isolation assertion allows the existing row-lock/draft-mirror timestamp to advance while checking that every live field remains unchanged.

No browser acceptance, real-model generation, Stripe checkout or hosted deployment is claimed for this backend phase. No AI trial budget was spent.

## Remaining delivery work

Existing catalog price labels and add-on preview coverage, supported deposit/reminder prerequisites, the first friendly booking URL, actual paid-model owner acceptance and the real walkthrough remain. Stripe sandbox purchase verification can wait for the owner's test key. Hosted Preview isolation, push/CI/review and production release gates still apply. This checkpoint does not declare the full paid AI builder complete.
