# Compact customer confirmation

The confirmed screen uses a small semantic green check, one status heading and the actual technician’s first name, followed by a compact receipt. Date/time lead the card; services and their compatible add-ons share a line, with duration and the appointment total below. Artist and location use small icons and subtle dividers. The review form and pending request receipt retain their existing structure and required acknowledgments.

The actions are Manage appointment, an accessible Add to calendar chooser alongside Directions, and Book another appointment. The calendar chooser retains the existing Google Calendar and Apple Calendar/download links. A lone available action fills its row. The cutoff sentence uses the configured number of hours. Confirmed screens retain only the existing eligible Free booking by Luster attribution; recovery and owner footer links remain on other pages. Missing private management links still expose secure recovery.

The result scrolls to the top and focuses its heading once. The small check precedes the facts, as requested in the revised design; facts precede management actions. Confetti and repeated reassurance are removed. Configured policies, custom instructions, reward estimates, text-preference status and rebooking remain conditional below the core actions. Service/add-on ownership, quantities, custom price descriptions and unknown manual prices remain accurate. Ordinary known item prices are consolidated into the total rather than repeated. Only trailing .00 is omitted from the compact total; fractional and starting-price text remain unchanged.

## Source and isolation

- Compact revision starts at current origin/main SHA `f3aa6dbbaef70aa38fadc31cfbc878fb97a65795` in a fresh `codex/luster-compact-confirmation` worktree. Its merge carries forward only the prior receipt work and preserves current main changes.
- Delivery continues through PR #339, using its existing remote branch `codex/luster-confirmation-polish`.
- Original checkout and earlier production/polish worktrees are preserved.
- Local QA uses the existing separate fictional Atelier clone, its own Redis namespace, and disabled/unconfigured external messaging, synchronization and payment providers. No production customer data is used.
- Screenshots remain development evidence. Final filming requires review, release and verification of the exact approved application SHA.

## Reproduction and acceptance

Use the repository’s Node 20 and committed package lock. The browser component harness renders real components and theme providers with explicit synthetic API fixtures; it is layout coverage, not persisted-booking evidence.

```sh
npx vitest run 'src/app/(unauth)/book/confirm/BookConfirmClient.test.tsx'
node node_modules/playwright/cli.js test --config tests/browser/booking-theme/playwright.config.ts confirmation-polish.spec.ts
npm run check-types
npm run lint
npm run test:all
npm run test:appointment-regression
npm run build
npm run security:check-secrets
```

Verify confirmed and pending states, missing management links, single/multi-service ownership, add-on quantities/custom descriptions/manual prices, fractional totals, configured cancellation hours and conditional owner instructions. Calendar keyboard access, menu dismissal and returned focus must work. Add to calendar preserves provider URLs without sending or synchronizing anything automatically.

Check desktop Chromium, mobile Chromium and iPhone WebKit at ordinary and narrow widths, 200% CSS text and increased user text spacing. Measure text/control contrast and focus; do not remove overflow assertions to meet the compact layout. The standard 390×844 demo should fit its attribution within the viewport; long names, extra instructions and enlarged text may scroll naturally. Physical-device/native text scaling and unfamiliar-reviewer tutorial acceptance remain pending.

Exact current-head commands/results, screenshots, real-booking persistence and delivery counts are recorded in the PR and ignored `local/confirmation-polish/` QA evidence. A successful synthetic POST verifies layout only. A separate real public booking must persist once with the same client and technician after reload, without provider deliveries; reload retains the existing conservative Booking received recovery state.

## Release gate

A local Vercel env pull writes [SENSITIVE] for protected values; these placeholders cannot establish missing or invalid credentials. Verify the hosted Preview build/runtime isolation guards and database marker, plus independent Neon project metadata. Keep messaging, calendar and payments inactive while checking fictional bookings. The local runner refuses fallback dotenv files. Deployment source preflight must exclude local QA, private dotenv and media artifacts through .vercelignore.

Required current-head CI, a healthy Preview, resolved reviews and protected-main production SHA verification precede release and final filming. Approval of the updated customer-booking reference precedes production of the remaining seven videos. Rollback is a reviewed revert of the scoped UI changes; no schema, public API, authentication, billing or delivery change is introduced.
