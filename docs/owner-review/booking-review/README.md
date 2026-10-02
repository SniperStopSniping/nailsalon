# Compact booking review

Base: `534e19ea38827b70abf21747f9e1d2e2d0748419` (v1.134.0).

This changes the final review step before submission. The previously released
confirmation/success screen and pending-request receipt remain separate.

The screen groups the real appointment data into a date/time-first receipt,
keeps the artist and duration together, uses existing service images only, and
omits missing or failed images. Edit opens the existing time selection route
with the selection and booking context intact. Per-tab contact persistence is
unchanged. No private contact values are added to the URL.

The details section retains required name, email and mobile fields and the
existing validation rules. It adds inline guidance and keeps 16px inputs,
autocomplete, mobile keyboard hints and visible keyboard focus. Required policy
acknowledgments remain unchecked; View policy opens the complete configured
policy in an accessible dialog. The total comes from existing quote logic;
a simple booking omits a repeated breakdown, while tax, discounts and deposits
retain their meaningful disclosures. Unknown or unavailable deposit collection is never
labelled as no deposit, and an enabled owner deposit instruction takes precedence. Manual approval still says Request this time.

Promotional texts are a separate optional, unchecked choice. The existing
`booking-sms-separated-v3` input extends the existing SMS preference contract,
recording appointment and promotional purposes independently through the
canonical appointment transaction. Legacy v1/v2 callers are unchanged.
Provider STOP suppression remains authoritative. The independent promotional
choice participates in both appointment idempotency and durable handoff
fingerprints. No new endpoint, database schema, sender, authentication path or
payment collection behaviour is introduced.

The assistant launcher is omitted from this route. Tenant palettes, fonts and
button foreground/background pairings remain in the existing theme system.
English and French copy are synchronized.

## Verification

Use Node.js 20 and the repository's guarded local configuration. Commands:

- `npx vitest run 'src/app/(unauth)/book/confirm/BookConfirmClient.test.tsx'`
- `npx vitest run src/libs/bookingSmsConsent.server.test.ts src/libs/bookingSmsConsent.test.ts src/libs/customerAssistant/reviewContracts.test.ts src/app/api/appointments/route.commitEffects.integration.test.ts`
- `npm run test:appointment-regression`
- `npx playwright test confirmation-polish.spec.ts --config tests/browser/booking-theme/playwright.config.ts`
- `npm run check-types`, `npm run lint:all`, `npm run test:all`, `npm run build`

The browser fixture uses synthetic data and intercepted responses; it does not
claim a production booking. It exercises real components/theme CSS across
Chromium desktop/mobile and iPhone WebKit emulation, including narrow screens,
contrast, enlarged text and text spacing. The policy fixture substitutes only
the Node-side crypto adapter that is unavailable in its browser-hosted shell.
The production Next server generates actual policy versions normally.

Private before/after screenshots and exact command results are kept under
ignored `local/booking-review/`. Physical-device and native keyboard testing
remain unexecuted; viewport emulation is not a real device. Release evidence
must record the merged SHA and production verification separately.

## Local review evidence

- Reference 390px detailed booking: main content reduced from 1538px to
  1203px (about 22%), while adding the distinct optional promotional choice.
- 84 browser checks passed across desktop Chromium, mobile Chromium and mobile
  WebKit emulation, covering all eight tenant palettes and custom button pairs.
- 119 appointment regression tests passed. The initial broad local run found
  missing public-surface classifications; those markers were corrected without
  weakening the architecture guard. Final reviewed-commit CI must run the full
  suite, build and browser gates before merge.
- No production bookings, external messages or payments were triggered.
