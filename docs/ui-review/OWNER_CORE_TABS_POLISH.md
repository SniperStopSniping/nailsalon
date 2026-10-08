# Owner core tabs polish

October 7, 2026. Related continuation of the approved owner sign-in and salon-selector visual system. Started from main `890e68b8` in `codex/owner-core-tabs-polish`; original desktop checkout is untouched.

## Changes

- **S31 / F04 — Calendar:** cream card, serif period heading, plum filter chips with 44px minimum height, compact Weekly/Monthly controls and one Availability disclosure containing the existing Block Time, working hours, Days Off and Google review actions. Escape returns focus to the disclosure; keyboard focus leaving it closes it. Null pointer-focus transitions in Safari do not swallow action clicks.
- **S23–S24 / F05 — Clients:** larger search/clear controls, accessible search name, spacious directory rows, consistent initial avatars, shared cream detail cards, serif client name and a clear 48px mobile section selector. Existing sections, financial provenance, history and communications controls remain.
- **S35 / F06 — Services:** more readable rows/prices, visible plum fallback icons, shared cards and search field. Selecting a service hides the catalog header/search and displays one detail header; Services returns to the same mounted catalog. Detail prices/duration use responsive serif typography.
- `AdminDetailCard` and `AdminSearchField` use existing owner tokens. The shared palette and header improvements are supplied separately by PR #374 and must be integrated before final screenshots/release.

No API, auth, tenancy, scheduling, service persistence, payment or messaging behavior is changed. No new pricing or entitlement behavior. Public customer themes are outside this change.

## Verification

- 158 unit cases across ClientsModal, ServicesModal, catalog tabs, Calendar availability/day details/block time and shared search pass.
- 20 isolated browser cases pass in Chromium and WebKit: 320/390/430/1280 widths, calendar navigation/availability keyboard and pointer access, block-time cancellation, client search/profile/back, service search recovery/detail/back, and empty/error recovery.
- TypeScript passes. Scoped lint has no errors; four pre-existing ClientsModal Tailwind warnings remain.
- The fixture renders actual production components with synthetic salon, client, appointment and service data. It rejects external fetches and API writes. It does not prove production authentication, real-provider delivery or physical-device behavior.
- Initial browser checks caught the Safari null-focus disclosure issue; corrected source passes both engines. Two new test selectors were corrected to match current Month default and Services/Back to Calendar labels. Geometry checks wait for the existing slide animation to settle.

## Evidence

Before screenshots: `/Users/me/Documents/Codex/2026-10-07/owner-core-tabs-polish/` (`S31-before-mobile.png`, `S23-before-mobile.png`, `S24-before-mobile.png`, `S35-before-mobile.png`). Final matching-palette after screenshots and hosted release checks are pending integration with PR #374.

## Still required

Protected-main release gates, exact-head preview, final combined visual evidence and production SHA check. Onboarding is the next scoped portion of the same user request; it is not complete in this change.
