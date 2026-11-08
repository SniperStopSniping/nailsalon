# Homepage review

`npx playwright test --config tests/browser/homepage/playwright.config.ts`
renders the real homepage components with Next Link/Image adapters. Set
`HOMEPAGE_TEST_URL` to exercise the full Next app or a preview instead.

Coverage: 360/390/430/768/1024/1440 widths, signup/login/shop destinations, mobile
menu selection/Escape/focus, carousel controls and stable dimensions, reduced
motion, asset loading, and Chromium CDP touch swiping. WebKit runs all except the
CDP-specific test. Unit tests cover tenant redirects, both onboarding flag states,
French destinations and promotion expiry.

`calendar.html` is an isolated screenshot fixture, not a production route. It
imports the current calendar component with synthetic data and refuses unexpected
requests. `capture-assets.mjs` captures it and the existing booking-theme fixture.
No server or database is attached to these Vite fixtures.
