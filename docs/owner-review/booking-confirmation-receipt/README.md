# Customer review and confirmation receipt

This focused visual change puts the appointment date and time first, separates services from their add-ons, and groups the artist, duration, and location in one receipt. The confirmed status appears before the receipt; a request awaiting salon approval keeps its pending status. Existing tenant colours, typography, totals, deposits, policies, consent, recovery, private management links, calendar links, and rebooking remain authoritative.

The result scrolls to the top and focuses its heading once when it replaces the review form. Later receipt updates do not move focus again. The smaller success treatment follows the receipt facts and honours reduced motion.

## Source and isolation

- Branch: `codex/luster-confirmation-polish`.
- Fresh `origin/main` base: `f7949f85d3e998d85d6fb25199567d100212288c`.
- Original checkout and video worktree are preserved.
- Local application QA uses a separate clone of the fictional Atelier demo database, its own Redis namespace, and disabled/unconfigured external delivery and payment providers. No production customer data is used.
- Before evidence comes from the real booking recording at released application SHA `3980197563c4ddc5774f6c5dcbfb8fe9f8827a6a`. The after screenshots remain development evidence until this change completes review and release. They are not final tutorial footage.

## Reproduction

Use the repository's Node 20 and committed package lock. The component harness renders the actual booking component and providers with explicit synthetic API fixtures; it is UI regression coverage, not evidence of a persisted booking.

```sh
npx vitest run 'src/app/(unauth)/book/confirm/BookConfirmClient.test.tsx'
node node_modules/playwright/cli.js test --config tests/browser/booking-theme/playwright.config.ts confirmation-polish.spec.ts --output=test-results/booking-confirmation
npm run check-types
npm run lint
npm run test:all
npm run test:appointment-regression
npm run build
npm run security:check-secrets
```

Browser coverage includes the supported palettes, 320/375/1280 CSS-pixel widths, confirmed and pending results, correct receipt details, reduced motion, focus arrival, native keyboard navigation, and CSS text enlargement to 200%. Chromium and iPhone 13 WebKit are emulation; physical-device and native text-size acceptance remain pending. macOS WebKit uses Option-Tab to include links in keyboard navigation.

## Review and release

The static review found a shared add-on key collision. Composite service/add-on keys and a multi-service regression now cover it. Repeated service labels are removed only for an exact matching single service; combined bookings retain add-on ownership, quantities, and configured prices.

Local focused validation passed: 132 booking-component tests, 17 architecture tests, the theme test, 69 desktop/mobile browser checks, 119 appointment regression tests, type checking, changed-source lint, and the secret scan. The palette checks protect the contrast of the total and small duration text by using the main tenant ink. Enabled primary buttons are measured at a text-contrast ratio of at least 4.5 across supported palettes, legacy themes, custom primary colours, different page/salon themes, and custom page appearance. Input focus outlines are measured at a ratio of at least 3 against the input surface.

Confirm and Manage use the existing paired primary-button background and text tokens. Gold defaults in the global, espresso, and pastel themes now use their established espresso ink rather than white; palette backgrounds and tenant branding are preserved. The confirmation focus outline uses the existing booking state-border token with main-ink fallback.

The real public flow created one additional fictional QA appointment for Emma Brooks: BIAB Overlay plus Simple Nail Art, October 2 at 10:00 a.m. Toronto time, CAD 75 fictional pricing, 90 minutes, Marie Dupont. A read-only database check after reload found exactly one confirmed appointment with the same tenant, technician, and linked client; provider deliveries remained zero. Reload retains the existing conservative "Booking received" recovery state. The original Sarah Morgan hero and the original recording environment are preserved. Private evidence is in the ignored `local/confirmation-polish/` directory.

Two attempted local full-suite runs hit resource contention and were interrupted. The full run caught the missing public-surface classification, which was fixed and independently retested; it also encountered unrelated timeouts. The isolated production build subsequently passed, and all three full Vitest CI shards and both CI builds passed at `12375504a25dd12f3428c1af7be1da48189fc484`.

That CI run caught changed-test lint padding and a Linux WebKit overflow at 200% CSS text size. The result receipt now uses the existing confirmation reflow styles, and its screenshots wait for the receipt to become fully visible. A subsequent CI run caught the broader receipt-before-celebration expectation; the small reserved-time reassurance now follows the facts. The original E2E guard is preserved. That run also encountered an unchanged admin address-privacy test failure; the exact test passed unchanged in a focused local recheck. All 69 focused browser checks pass after the corrections; a new full CI run remains required.

Hosted Preview is blocked by configuration: its environment lacks the verified nonproduction database host and marker, `APP_ENV=preview`, and Development/test provider key pairs required by the repository guards. No Preview deployment or connection to that unverified database was attempted. The safe local runner also refuses fallback dotenv files so a CLI environment pull cannot silently add external credentials. This is a release blocker, not a passed preview check.

Required CI, a healthy preview, resolved review conversations, and production SHA verification are required before final filming. The remaining seven videos stay behind approval of the updated customer-booking reference.
