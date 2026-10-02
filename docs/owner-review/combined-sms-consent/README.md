# Compact combined booking-text consent

The final booking review's Your details card now has one optional checkbox:

> Text me appointment confirmations, reminders, review requests, and occasional salon promotions
>
> Optional. Reply STOP anytime.

The support line follows the main copy by 6px, and Terms · Privacy follows by 10px. Labels, theme tokens, legal-link destinations, 44px legal tap areas, and submission disabling are preserved. The appointment-policy checkbox remains separate and unchecked. Disabled SMS settings still hide the text choice.

Because the choice includes promotions, it starts unchecked for both enabled salon defaults. Checking grants all disclosed purposes; checking then unchecking revokes them. Booking remains possible without opting into texts. The combined wording uses `booking-sms-combined-v4`; the existing consent table/transaction stores the same decision for reminders, transactional messages and salon promotions. Untouched v4 is nonexplicit default-off, never a fabricated customer action. Existing v1/v2 history and v3 independent choices remain supported; provider/shared STOP still takes precedence.

CRTC reference: https://crtc.gc.ca/eng/com500/faq500.htm (prechecked boxes cannot establish express marketing consent).

## Verification commands

Use Node 20 with the repository's isolated test environment. Never use customer data or live SMS/email providers.

```sh
npx vitest run src/libs/bookingSmsConsent.test.ts src/libs/bookingSmsConsent.server.test.ts src/libs/customerAssistant/reviewContracts.test.ts src/app/api/appointments/route.commitEffects.integration.test.ts
npx vitest run 'src/app/(unauth)/book/confirm/BookConfirmClient.test.tsx'
npm run test:appointment-regression
npm run check-types
npm run lint
npm run security:check-secrets
npx playwright test --config tests/browser/booking-theme/playwright.config.ts tests/browser/booking-theme/confirmation-polish.spec.ts
npx playwright test --config tests/browser/l1-public-booking/playwright.config.ts
npm run build
```

The theme fixture uses real components with synthetic data. The L1 journey requires the documented disposable PostgreSQL/Redis target and asserts a real booking plus three matching persisted consent records. Neither synthetic component capture nor mobile browser emulation is physical-device or unfamiliar-human acceptance. Large screenshots, private setup, logs and release evidence stay under ignored `local/sms-consent/`.
