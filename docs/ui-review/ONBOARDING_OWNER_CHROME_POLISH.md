# Onboarding: Luster owner visual polish

Review date: October 7, 2026. Baseline: `origin/main` at `890e68b8`.

## Scope

The setup interface now shares the approved owner-entry blush ground, ivory cards,
berry actions, champagne details, serif headings, and clean sans-serif fields.
The SVG sparkle wordmark replaces the old gradient initial tile. Input text is
16px and fields/actions have comfortable mobile hit areas. Selected choices,
validation errors, keyboard focus, autosave, and navigation retain their states.

Customer preview themes and the custom Isla public design remain independently
configured. No account, entitlement, provider, booking, or payment logic changed.
The reassurance copy now says the owner previews their site before claiming the
free plan, matching the single founding offer.

## Evidence

- 1,397 prototype unit tests passed with two workers. The first unrestricted run
  timed out in two existing suites under local load; those suites separately
  passed all 30 tests, followed by the complete bounded passing run.
- Prototype TypeScript and both production stylesheet integration tests passed.
- Four geometry checks cover twelve real setup screens at 320, 390, 430 and
  1280px. They assert headings, product tokens, horizontal fit and action sizes.
  Saved-state navigation is restricted to disposable local fixtures, including
  the Quick Book-only booking-layout branch.
- All 17 browser checks passed together, including the existing desktop and
  founding-offer checks and the new owner chrome checks (1.8 minutes).
- Manual mobile review followed setup, contact validation, hours, style, and
  the account-save boundary. Screenshots are saved outside the repository at
  `Documents/Codex/2026-10-07/onboarding-visual-polish/`.

## Limits

Local screenshots use the existing synthetic Daniela / Isla fixture, not live
salon records. No real signup, password, legal acceptance, customer message,
payment or publishing action was submitted. Authenticated account persistence
and physical-phone acceptance remain separate release checks.
