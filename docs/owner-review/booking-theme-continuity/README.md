# Booking colour continuity — owner review

The current onboarding palette now follows the client through service selection,
artist selection, time selection, confirmation, and the confirmed receipt.
This is a local implementation, not a production release.

## Source of truth

The eight current options are **Luster Berry, Blush Cocoa, Terracotta Cream,
Sage Stone, Lilac Plum, Navy Ivory, Monochrome, and Black Champagne**.

Onboarding persists `snapshot.site.palettePresetId` / style into
`bookingPage.draft.sitePalettePreset` / `siteStylePreset`. Existing publish and
preview rules select the side each public page passes to `PublicSalonPageShell`.
The implementation reuses `getCustomerSitePresentationCssVariables`, already
used by `BookServiceClient`, rather than the obsolete Espresso/Lavender options
used for the earlier Figma concept.

Before: the service page installed the new tokens locally; later screens could
fall back to older theme values and hard-coded white cards/text.

After: the common booking shell installs the same selected palette, and the
existing `--theme-*` and `--n5-*` consumers receive equivalent colours. Calendar
selection, time buttons, progress, summary cards, avatars without photos, contact
forms, and receipt surfaces use the matching text/background combinations.
Legacy salons without these presets retain their existing theme source. The
saved site palette retains service-page precedence over the older brand accent.
Non-booking pages are not opted into the new wrapper.

No new setting, persistence format, schema, premium override activation,
availability calculation, scheduling rule, payment rule, or authorization gate
was added. The server-supplied live/draft side remains authoritative. No browser
storage, global theme mutation, or independent draft lookup was introduced.

## Screenshots

These capture actual production components and CSS in a synthetic, isolated
browser fixture. They are not live salon appointments. Fonts use the fixture's
local fallbacks; no Next.js font download or production service is required.

| State | Mobile Safari, 375px | Desktop Chromium, 1280px |
| --- | --- | --- |
| One time, Luster Berry | [Mobile](mobile-one.png) | [Desktop](desktop-one.png) |
| Three times, Navy Ivory | [Mobile](mobile-three.png) | [Desktop](desktop-three.png) |
| Many times, Sage Stone | [Mobile](mobile-many.png) | [Desktop](desktop-many.png) |
| No times, Black Champagne | [Mobile](mobile-zero.png) | [Desktop](desktop-zero.png) |
| Confirm, Black Champagne | [Mobile](mobile-confirm.png) | [Desktop](desktop-confirm.png) |
| Receipt, Black Champagne | [Mobile](mobile-receipt.png) | [Desktop](desktop-receipt.png) |

The current month calendar is intentionally preserved. The compact upcoming-week
calendar and broader layout polish remain a separate Figma concept, not part of
this colour-continuity change. Availability-count copy and preparation-message
wording are unchanged. The existing empty state / next-date lookup is preserved;
the fixture can advance from an empty Saturday to Monday because Sunday is closed.

## Checks

- Focused initial run: 182 tests passed. Additional shell coverage: 24 passed.
- Affected dependency suite: 863 passed, 10 skipped; the skipped PostgreSQL
  lifecycle concurrency lane needs a separately attested disposable database.
- Appointment regression: 103 passed.
- Browser matrix: **54 passed** across desktop Chromium, mobile Chromium, and mobile WebKit. Covers all
  eight palettes through four steps, rendered button/date/summary colours,
  confirmation-to-receipt continuity, keyboard selection, omitted unavailable
  choices, 44px+ time buttons, 320px/375px overflow, and long preparation copy.
- `npm run check-types`: passed using approved non-secret CI placeholders.
  Initial runs without explicit environment configuration were rejected by the
  repository guard; no guard was bypassed.
- Focused ESLint: no errors; existing confirmation Fast Refresh warnings and
  fixture-only lint warnings remain.
- Secret leak scan and `git diff --check`: passed.

Reproduce the isolated browser matrix:

```sh
npx playwright install chromium webkit
npx playwright test --config tests/browser/booking-theme/playwright.config.ts
```

The browser fixture uses the real shell, context providers and booking clients;
only framework adapters, server-only content lookup, and HTTP responses are
synthetic. It never connects to a database, sends a message, takes a deposit, or
creates a real appointment. Full authenticated/persisted E2E, production build,
hosted preview, CI, and production verification are not claimed.

## Changed files

- `src/components/PublicSalonPageShell.tsx` and its test: shared palette boundary.
- `src/libs/customerSitePresentation.ts` and its test: one palette, both token
  families, contrast regression coverage.
- `src/styles/global.css`: scoped booking surfaces and text.
- `src/components/booking/BookingStepHeader.tsx`, `BookingSummaryCard.tsx`,
  `TechnicianAvatar.tsx`: palette-aware progress, summary and fallback avatar.
- `src/app/(unauth)/book/{time,tech,confirm}/*Client.tsx`: contrast-safe selected
  controls and dark-theme surfaces, without changing handlers or booking logic.
- `tests/browser/booking-theme/`: isolated fixtures, framework adapters and
  Playwright matrix.
- This review document and its screenshots.

## Isolation / delivery

- Worktree: `/Users/me/nailsalon-worktrees/booking-theme-continuity-20260912`
- Branch: `codex/booking-theme-continuity-20260912`
- Base: `34c6daf727d7552465d1af20ac3489d6a84a39b7`, freshly fetched `origin/main`.
- No edits, checkout, reset, clean, stash, rebase, merge or deployment of the
  active Site Builder worktree/branch.
- Nothing pushed, merged, published or deployed. Owner review is required.
