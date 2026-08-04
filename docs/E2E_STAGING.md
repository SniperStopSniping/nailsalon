# Browser E2E Gate

## Primary Recommendation

The real browser-confidence path is now Preview-first.

Use local Playwright for debugging selectors, fixture helpers, and individual flows.
Use the exact Preview deployment for the default external gate and the focused
Preview checks required by a release. A separate staging-like environment is an
explicit alternative, not the default target.

Required journeys across those checks:
- guest booking and editable contact collection
- confirmation with the canonical manage action
- retired `/change-appointment` route forms
- safe find-booking guidance when a mocked success omits `manageUrl`
- tokenized manage -> reschedule -> cancel
- staff appointment completion
- super-admin -> impersonation -> admin action -> end impersonation

Important:
- the external `E2E_BASE_URL` path is the primary gate
- local runs still help with debugging, but they are not the final confidence path
- the app uses default-locale paths without an `/en` prefix, and the helpers normalize that automatically

## Preview Fixture Requirements

The Preview gate assumes stable seeded fixture data. The environment must provide:
- one active salon matching `E2E_SALON_SLUG`
- a matching display name `E2E_SALON_NAME`
- online booking enabled for that salon
- one active service matching `E2E_SERVICE_ID`
- that service must have a duration matching `E2E_SERVICE_DURATION_MINUTES`
- at least one active technician who can perform that service
- that technician must have upcoming availability within the next 21 days
- one staff login matching `E2E_STAFF_PHONE`
- one super-admin login matching `E2E_SUPER_ADMIN_PHONE`
- deterministic credentials for the staff and super-admin journeys

Recommended canonical fixture values:
- `E2E_SALON_SLUG=nail-salon-no5`
- `E2E_SALON_NAME="Nail Salon No.5"`
- `E2E_SERVICE_ID=svc_biab-short`
- `E2E_SERVICE_DURATION_MINUTES=75`
- `E2E_STAFF_PHONE=4165550201`
- `E2E_SUPER_ADMIN_PHONE=4165550101`
- `E2E_OTP_CODE=123456`

If the Preview environment does not keep that fixture data stable, the gate will drift and become flaky.

## Deterministic OTP Requirement

The Preview gate assumes deterministic OTP.

Preferred options:
- Twilio Verify disabled in the Preview E2E environment so `123456` works
- an explicit OTP test path that makes the configured `E2E_OTP_CODE` valid for browser runs

If Preview uses live Twilio Verify without a deterministic test OTP path, this gate is not dependable.

## Environment Variables

Required Preview inputs:

```bash
E2E_BASE_URL=https://your-preview-host
E2E_SALON_SLUG=nail-salon-no5
E2E_SALON_NAME="Nail Salon No.5"
E2E_SERVICE_ID=svc_biab-short
E2E_SERVICE_DURATION_MINUTES=75
E2E_STAFF_PHONE=4165550201
E2E_SUPER_ADMIN_PHONE=4165550101
E2E_OTP_CODE=123456
```

Optional overrides:
- `E2E_STAFF_OTP_CODE`
- `E2E_SUPER_ADMIN_OTP_CODE`
- `E2E_LOCALE`
- `E2E_SERVICE_NAME`
- `E2E_STAFF_TECH_NAME`

`islanailsalon.com` and `www.islanailsalon.com` are rejected at Playwright
configuration load. `E2E_ALLOW_PRODUCTION=1` is reserved for a separately
owner-authorized Production run and should be supplied only for that invocation.

## Commands

### Recommended Preview gate

```bash
E2E_BASE_URL=https://your-preview-host \
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
E2E_BASE_URL=https://your-preview-host \
E2E_SALON_SLUG=nail-salon-no5 \
E2E_SALON_NAME="Nail Salon No.5" \
E2E_SERVICE_ID=svc_biab-short \
E2E_SERVICE_DURATION_MINUTES=75 \
E2E_STAFF_PHONE=4165550201 \
E2E_SUPER_ADMIN_PHONE=4165550101 \
E2E_OTP_CODE=123456 \
npm run test:e2e:core:staging
```

### Client PR 0B1 focused preview check

`customer-journeys.e2e.ts` is not part of the default hosted E2E or Checkly
patterns. Run it explicitly against the exact Preview deployment:

```bash
E2E_BASE_URL=https://your-preview-host \
npx playwright test tests/e2e/customer-journeys.e2e.ts \
  --project=chromium --no-deps
```

This focused spec intercepts appointment creation. It verifies canonical
manage-link passthrough, the safe missing-`manageUrl` state, retired route
forms, guest contact collection, and zero `/api/auth/*` browser traffic
without creating a real appointment.

### Local debug only

```bash
npm run db:migrate:development
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
- Customer flows use guest contact details and assert that legacy customer-auth
  endpoints receive no browser traffic.
- Local commands intentionally blank Twilio env vars so OTP falls back to the deterministic `123456` development path.
