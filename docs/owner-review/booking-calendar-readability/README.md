# Calendar and booking readability — owner review

## Delivery status

Local review candidate only. Not pushed, merged, published, or deployed.

- Worktree: `/Users/me/nailsalon-worktrees/booking-calendar-readability-20260912`
- Branch: `codex/booking-calendar-readability-20260912`
- Base: `58c49c98201a7de67181db4b146cc5a2e393f324` (current `origin/main` when this work began)
- The active Site Builder V2 + Booking Integration Lab worktree and branch were not modified. This task has its own checkout and index.

## What happened to the calendar?

The preceding release shipped palette continuity through the booking screens, but still rendered the full-month calendar. The compact calendar was not part of that implementation. This change adds it to the real time-selection component, not just a design mockup.

## Before / after

- Before: a large month grid included faded past dates and small progress/appointment labels.
- After: seven dates by default, previous/next-week controls, full date screen-reader labels, a keyboard-focusable selected date, and an optional full month. Past dates are not rendered as appointment choices. The optional month preserves weekday alignment with empty cells.
- At 375px the standard week fits in one row. At 320px, or with easier reading enabled, the seven days wrap to avoid tiny targets. Very large browser text reflows the summary and time choices rather than clipping them.
- Closed weekdays remain disabled using the same existing salon-rule input. Browsing a week does not select a date or fetch an alternative availability result. Choosing a date still invokes the existing canonical request.
- The appointment summary no longer truncates the service/location or fades its supporting text. Progress labels are larger and no longer faded.

## Easier to read

A shared, keyboard-operable `aria-pressed` button is available throughout service selection, technician selection, time selection, confirmation, and the receipt. It provides neutral white backgrounds, dark text, simple system sans-serif fonts, larger small labels, and strong focus outlines. Brand appointment/time controls remain recognisable; low-contrast decorative accent text becomes dark.

The preference is stored under `luster:booking-reading:v1` in the visitor's browser. It never changes the salon's onboarding palette, saved configuration, or database. Storage failures do not prevent the toggle or booking from working. Turning it off restores the normal salon appearance. New control copy includes English and French variants.

Confirmation/receipt navigation stays in normal document flow with sticky positioning so it cannot cover the reading control.

## Availability and preparation (unchanged)

- One opening: “Only 1 opening left today”. Two or three: “Only 2/3 openings left today”. Four or more: “N times available”. Counts continue to use the canonical bookable results, including the existing past-time/booked-slot protections.
- No openings: the existing intentional date-specific empty state and next-available/choose-another-date recovery remain. No unavailable-time grid is added.
- Preparation copy still reports service duration plus the actual returned preparation buffer. No scheduling-engine explanation is reintroduced.
- No changes to availability calculations, minimum notice, salon timezone, locations, technicians, durations, buffers, holds, payments, booking policies, capacity, or schema.

## Screenshots

Real React booking screens and shared theme CSS, using isolated synthetic appointments and framework adapters. No real bookings/payments/messages or customer data. Fixture font adapters use fallback fonts; these are not production screenshots.

| Mobile, 375px (WebKit) | Desktop, 1280px (Chromium) |
| --- | --- |
| [One opening](mobile-one.png) | [One opening](desktop-one.png) |
| [Three openings](mobile-three.png) | [Three openings](desktop-three.png) |
| [Many openings](mobile-many.png) | [Many openings](desktop-many.png) |
| [No openings](mobile-zero.png) | [No openings](desktop-zero.png) |
| [Easier reading](mobile-easy-reading.png) | [Easier reading](desktop-easy-reading.png) |

## Verification

- Affected Vitest graph: **418 passed**, 19 suites (`npx vitest related --run` with the changed production TS/TSX entry points).
- Appointment regression: **103 passed** (`npm run test:appointment-regression`).
- Changed-file unit selection: **187 passed** (`npm run test`); new preference tests are additionally covered by the affected graph above.
- Browser suite: **114 passed** across desktop Chromium, mobile Chromium, and mobile WebKit (`npx playwright test --config tests/browser/booking-theme/playwright.config.ts`), plus **3 passed** for the subsequently added easier-reading receipt test.
- `npm run check-types`: passed, using CI-only placeholder credentials rather than real provider secrets.
- `npm run lint`: passed, no errors; 11 existing confirmation/fixture warnings. Explicit ESLint on the new files also passed.
- `npm run security:check-secrets` and `git diff --check`: passed. Final screenshot retakes: 3 passed after the desktop toolbar background polish.
- No booking-engine tests were weakened.

Browser coverage includes all eight onboarding palettes, available-only slots, zero/one/three/many openings, week/month navigation, year rollover (unit), selected-date semantics, keyboard focus, 44px date targets, 320px/375px overflow, 200% root text sizing, long preparation copy, saved preferences across screens, and computed 4.5:1 contrast for key time-screen text/control pairs in both modes.

This is targeted accessibility verification, not a claim of complete WCAG conformance. Full repository CI, a deployed preview, a real-device assistive-technology audit, production build, and live production booking have not been run for this candidate. No production credentials or services were needed.

Additional evidence: [320px with 200% text sizing](mobile-320-text-200.png). The React/Next.js guidance informed the client-only preference restoration, shared server/client boundary, and reflow checks; browser verification was performed before handoff.

## Files changed

- `src/app/(unauth)/book/time/BookTimeClient.tsx` and its test — week/month presentation and accessible date controls; canonical availability path preserved.
- `src/app/(unauth)/book/confirm/BookConfirmClient.tsx` — confirmation/receipt header positioning and matching top spacing only.
- `src/components/PublicSalonPageShell.tsx` and its test — shared reading-preference boundary, existing tenant/draft palette resolution unchanged.
- `src/components/booking/BookingReadingPreferences.tsx` and its test — reversible local preference.
- `src/components/booking/BookingStepHeader.tsx` and its test — readable progress, wrapping salon name and fixed 44px back target.
- `src/components/booking/BookingSummaryCard.tsx` — readable, untruncated summary and large-text reflow.
- `src/locales/bookingReading.ts` — English/French controls.
- `src/styles/global.css` — booking-scoped preference styles, focus, contrast and responsive reflow.
- `src/app/[locale]/[slug]/book/service/page.test.tsx` — supply the route-params mock consumed by the new shared client control; existing preview-isolation assertions retained.
- `tests/browser/booking-theme/main.tsx` — synthetic start timestamps follow the date requested by the real component.
- `tests/browser/booking-theme/readability.spec.ts` and `contrast.spec.ts` — new browser regressions/evidence.
- This review report and screenshots.
