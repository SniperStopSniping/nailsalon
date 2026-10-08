# Owner settings and payment presentation polish

Part of the approved dashboard/onboarding brief. Began from clean main 7eb2045d
in codex/owner-settings-polish on October 7, 2026 Toronto. Related form PR376 is merged and live at 7db6e01e. That released main is
integrated in this follow-up; both forms and settings CI commands are retained.

## Actual observations and changes

| References | Observed in actual components | Scoped change |
| --- | --- | --- |
| S12 / F09 | The long Booking Rules & Policies Back label wrapped over three lines beside a second title at 390px. Editable controls used 15px text. | One full-width Back row for focused settings pages, followed by the serif page heading. Existing labelled 15px fields become 16px/48px controls with visible plum focus. |
| S63 / F09 | Account fields used the older 10px corners and 15px text; small square actions and 12px footnotes differed from owner entry. | Shared cream cards and pill actions, readable fields and footnotes. Preserve sign-in email locking, save payload and dirty-exit guard. |
| S64 / F09 | Native blue checkboxes and old field geometry appeared inside the blush owner UI. | Scoped plum checkbox/radio accents, 16px fields and shared actions. Provider configuration and all channel availability gates remain unchanged. |
| S60 / F08 | Usage & billing had an old white sheet, small square actions and a 14px/36px history filter; the free-text card used a black CTA. | Matching cream cards and serif heading, 48px plum/secondary actions, readable history filter and wrapping rows. Preserve provider, allowance, balance, purchase and message-history contracts. |
| S59 / F08, F09 | Payment setup used a black CTA and green decorative icon; Status not confirmed yet used a pale border token as text. | Owner plum action/blush icon, readable muted status, serif heading and bounded desktop width. Preserve amber/red/green readiness badges and the server-owned setup action. |

Shared Settings section cards and save buttons carry the same treatment into
booking policy, payments/taxes and plan presentation. Explicit save, autosave,
validation, provider requests, entitlement and customer preview behavior are
unchanged. Discard/Keep editing targets are now at least 44px; Discard retains
its distinct caution colour. Disabled actions retain their disabled styling.
No provider, pricing, credit balance, customer branding or business data changes.

## Evidence

The new tests/browser/ownerSecondary fixture imports actual AppModal, Settings,
Payments, UsageBilling and owner management components with the real owner theme and fonts.
Synthetic read responses stay in memory; writes return a simulated error (or the explicit identity-verification-required response) and
external requests are rejected. It cannot contact payment/message providers.

An initial review of the older Settings fixture lacked the outer owner theme;
that unthemed appearance was not treated as a production defect. The retained
before/after screenshots use the correctly themed actual AppModal fixture.

- 115 existing Settings/Stripe/owner-management unit checks passed.
- 50 Chromium/WebKit browser cases at 320/390/430/1280px passed after adding Usage & billing coverage.
- 32 existing UsageBilling/StarterSmsCredits unit checks passed in addition to the 115 settings checks.
- 4 existing Settings/Plan browser regressions and 28 Booking Page editor cases
  passed, including hosted editor leave guards, custom Isla scope and enlarged text.
- Production typecheck and source/fixture lint passed (two existing fast-refresh warnings).
- Browser checks cover field size, no overflow, account email locking, unsaved
  recovery, failed-save draft retention, rule Back geometry and payment setup
  failure without navigation. No production operation was submitted.
- One initial test incorrectly expected the Payments hub title to have heading
  semantics. Actual DOM shows its existing generic title and destination buttons;
  the corrected assertion verifies those and Back's resulting destination. All
  eight initial failures were that same locator mistake, not eight app failures.

Before/after screenshots are retained in the dated owner-settings-polish folder:
S12-booking-rules-before/after-mobile, S63-account-before/after-mobile,
S59-stripe-before/after-mobile and S59-stripe-after-desktop, plus S64 notifications.
S60-usage-before/after-mobile, S60-allowance-verification-320,
S60-portal-recovery-320 and S60-history-after-320 record the actual billing
component. At 320px, the history filter and status rows fit their cards without
internal horizontal overflow; the header Close remains reachable while scrolling.
A hot-reload duplicate in the development fixture was cleared with a full reload
before final captures. It was not treated as a production defect.
The fixture's unavailable messaging and incomplete payment examples are synthetic
states, not findings about live salon/provider readiness. Temporary viewport
changes were cleared after review.

## Delivery and remaining acceptance

After integrating released main 7db6e01e, 253 focused unit checks and 160
browser cases pass together: 50 secondary, 52 forms, 4 Settings/Plan, 28 Booking
Page editor, 4 SMS allowance and 22 core-tab cases. Production types and explicit
source/fixture lint pass; only the two existing fast-refresh warnings remain.
The only merge conflict was adjacent CI registrations, resolved by retaining
both suites. No application conflict or production data operation occurred.

This follow-up awaits required hosted CI/Preview and normal protected-main merge. Real-account,
physical-phone/screenreader and controlled provider acceptance remain separately
recorded in the master audit companion. AI voice stays deferred.
