# Owner core tabs polish

October 7, 2026. Related continuation of the approved owner sign-in and salon-selector visual system. Started from main `890e68b8` in `codex/owner-core-tabs-polish`; original desktop checkout is untouched.

## Changes

- **S31 / F04 — Calendar:** cream card, serif period heading, plum filter chips with 44px minimum height, compact Weekly/Monthly controls and one Availability disclosure containing the existing Block Time, working hours, Days Off and Google review actions. Escape returns focus to the disclosure; keyboard focus leaving it closes it. Null pointer-focus transitions in Safari do not swallow action clicks.
- **S23–S24 / F05 — Clients:** larger search/clear controls, accessible search name, spacious directory rows, consistent initial avatars, shared cream detail cards, serif client name and a clear 48px mobile section selector. Existing sections, financial provenance, history and communications controls remain.
- **S35 / F06 — Services:** more readable rows/prices, visible plum fallback icons, shared cards and search field. Selecting a service hides the catalog header/search and displays one detail header; Services returns to the same mounted catalog. Detail prices/duration use responsive serif typography.
- `AdminDetailCard` and `AdminSearchField` use existing owner tokens. The shared palette and header improvements from merged PR #374 are integrated from main `59c88a0e`.

No API, auth, tenancy, scheduling, service persistence, payment or messaging behavior is changed. No new pricing or entitlement behavior. Public customer themes are outside this change.

## Verification

- 160 unit cases across ClientsModal, ServicesModal, catalog tabs, Calendar availability/day details/block time, shared search and onboarding stylesheet integration pass after merging main.
- 20 isolated browser cases pass in Chromium and WebKit: 320/390/430/1280 widths, calendar navigation/availability keyboard and pointer access, block-time cancellation, client search/profile/back, service search recovery/detail/back, and empty/error recovery.
- TypeScript passes. Scoped lint has no errors; four pre-existing ClientsModal Tailwind warnings remain.
- The fixture renders actual production components with synthetic salon, client, appointment and service data. It rejects external fetches and API writes. It does not prove production authentication, real-provider delivery or physical-device behavior.
- Initial browser checks caught the Safari null-focus disclosure issue; corrected source passes both engines. Two new test selectors were corrected to match current Month default and Services/Back to Calendar labels. Geometry checks wait for the existing slide animation to settle.

## Evidence

Before and matching-palette after screenshots: `/Users/me/Documents/Codex/2026-10-07/owner-core-tabs-polish/`. Mobile files use the existing S31, S23, S24 and S35 references. The Calendar desktop fixture uses the production component's 1024px maximum width; the 1280px screenshot includes its surrounding canvas. Client profile captures show synthetic records.

## Still required

Protected-main release gates, exact-head preview and production SHA check. Onboarding is included in this combined change; see `ONBOARDING_OWNER_CHROME_POLISH.md`. Its complete 17-case browser check passed again after integration with main.
