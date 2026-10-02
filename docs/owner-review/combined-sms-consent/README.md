# Compact booking-text preferences

The final booking review's Your details card keeps appointment texts separate from salon promotions:

> Text me appointment confirmations, reminders, and review requests
>
> Text me salon promotions (optional)
>
> Optional. Reply STOP anytime.

Appointment texts follow the salon's `default_on` or `default_off` setting; disabled SMS settings hide both choices. Promotions always start unchecked and only an affirmative promotion-checkbox action grants them. The server records that appointment and promotion decision separately using `booking-sms-separated-v3`. The existing STOP/provider suppression remains authoritative, and the appointment-policy checkbox remains separate and unchecked.

Older `booking-sms-combined-v4` records remain readable as historical choices; the new UI does not reinterpret them. Salon promotions cannot be inferred from an appointment-text default.

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
