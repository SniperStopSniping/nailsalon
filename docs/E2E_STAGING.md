# Browser E2E Gate

## Primary Recommendation

The real browser-confidence path is now staging-first.

Use local Playwright for debugging selectors, fixture helpers, and individual flows.
Use a staging or staging-like environment as the actual E2E gate.

Core journeys covered by the gate:
- customer OTP login
- booking
- confirmation
- profile -> reschedule -> cancel
- staff appointment completion
- super-admin -> impersonation -> admin action -> end impersonation

Important:
- the external `E2E_BASE_URL` path is the primary gate
- local runs still help with debugging, but they are not the final confidence path
- the app uses default-locale paths without an `/en` prefix, and the helpers normalize that automatically

## Staging Fixture Requirements

The staging gate assumes stable seeded fixture data. The environment must provide:
- one active salon matching `E2E_SALON_SLUG`
- a matching display name `E2E_SALON_NAME`
- online booking enabled for that salon
- one active service matching `E2E_SERVICE_ID`
- that service must have a duration matching `E2E_SERVICE_DURATION_MINUTES`
- at least one active technician who can perform that service
- that technician must have upcoming availability within the next 21 days
- one staff login matching `E2E_STAFF_PHONE`
- one super-admin login matching `E2E_SUPER_ADMIN_PHONE`
- deterministic OTP for customer, staff, and super-admin

Recommended canonical fixture values:
- `E2E_SALON_SLUG=nail-salon-no5`
- `E2E_SALON_NAME="Nail Salon No.5"`
- `E2E_SERVICE_ID=svc_biab-short`
- `E2E_SERVICE_DURATION_MINUTES=75`
- `E2E_STAFF_PHONE=4165550201`
- `E2E_SUPER_ADMIN_PHONE=4165550101`
- `E2E_OTP_CODE=123456`

If the staging environment does not keep that fixture data stable, the gate will drift and become flaky.

## Deterministic OTP Requirement

The staging gate assumes deterministic OTP.

Preferred options:
- Twilio Verify disabled in staging-like E2E environments so `123456` works
- an explicit OTP test path that makes the configured `E2E_OTP_CODE` valid for browser runs

If staging uses live Twilio Verify without a deterministic test OTP path, this gate is not dependable.

## Environment Variables

Required staging inputs:

```bash
E2E_BASE_URL=https://your-staging-host
E2E_SALON_SLUG=nail-salon-no5
E2E_SALON_NAME="Nail Salon No.5"
E2E_SERVICE_ID=svc_biab-short
E2E_SERVICE_DURATION_MINUTES=75
E2E_STAFF_PHONE=4165550201
E2E_SUPER_ADMIN_PHONE=4165550101
E2E_OTP_CODE=123456
```

Optional overrides:
- `E2E_CUSTOMER_OTP_CODE`
- `E2E_STAFF_OTP_CODE`
- `E2E_SUPER_ADMIN_OTP_CODE`
- `E2E_LOCALE`
- `E2E_SERVICE_NAME`
- `E2E_STAFF_TECH_NAME`

## Commands

### Recommended staging gate

```bash
E2E_BASE_URL=https://your-staging-host \
E2E_SALON_SLUG=nail-salon-no5 \
E2E_SALON_NAME="Nail Salon No.5" \
E2E_SERVICE_ID=svc_biab-short \
E2E_SERVICE_DURATION_MINUTES=75 \
E2E_STAFF_PHONE=4165550201 \
E2E_SUPER_ADMIN_PHONE=4165550101 \
E2E_OTP_CODE=123456 \
npm run test:e2e:gate
```

### Equivalent core-flow command

```bash
E2E_BASE_URL=https://your-staging-host \
E2E_SALON_SLUG=nail-salon-no5 \
E2E_SALON_NAME="Nail Salon No.5" \
E2E_SERVICE_ID=svc_biab-short \
E2E_SERVICE_DURATION_MINUTES=75 \
E2E_STAFF_PHONE=4165550201 \
E2E_SUPER_ADMIN_PHONE=4165550101 \
E2E_OTP_CODE=123456 \
npm run test:e2e:core:staging
```

### Local debug only

```bash
npm run db:migrate:dev
npm run db:seed
npm run db:seed:e2e
npm run dev:e2e:local
E2E_BASE_URL=http://localhost:3101 npm run test:e2e:core:staging
```

## Stability Notes

- Playwright runs serially (`workers=1`) for the core gate to avoid session collisions.
- When `E2E_BASE_URL` is set, Playwright does not boot a local server.
- The external-base-url path gets longer timeouts, one retry, and retained traces/videos.
- Staff and super-admin sessions are bootstrapped once in `tests/e2e/auth.setup.ts` and reused via storage state.
- Customer flows still use real browser session behavior, but the suite now prefers seeded routing and stable test ids over brittle layout-dependent clicks.
- Local commands intentionally blank Twilio env vars so OTP falls back to the deterministic `123456` development path.
