# Local QA Guide

## Local App Boot

### 1. Install, initialize, and migrate
```bash
npm ci
npm run db:initialize:development
npm run db:migrate:development
```

Initialization creates the marker only when the approved target is catalog-empty,
or verifies an existing exact `development` marker. Migration then independently
attests the exact host and marker before running the repository migration chain.
Neither command prints the connection string. No direct SQL is required.

### 2. Seed if needed
```bash
npm run db:seed:development
```

Use this if:
- booking pages say online booking is not ready
- your local salon has no active services or technicians

### 3. Start the app
```bash
npm run dev:next
```

Open:
- [http://localhost:3000](http://localhost:3000)
- or whichever port Next reports if `3000` is busy

## Guest Booking / Manage-Link QA

### Booking flow
- Go to:
  - `/book/service?salonSlug=nail-salon-no5`
  - `/book/tech?salonSlug=nail-salon-no5&serviceIds=svc_biab-short`
- Verify:
  - service selection carries `salonSlug`
  - time selection shows real availability
  - confirmation collects editable guest name, email, and phone
  - confirm only writes after explicit confirmation
  - no customer account, login, or floating-dock controls appear
  - the booking request uses the guest booking subject
  - a returned `manageUrl` is rendered unchanged

### Manage-link fallback and retired route
- With a mocked successful response that omits `manageUrl`, verify:
  - confirmation remains successful
  - no raw appointment ID appears
  - the fallback points to the tenant-scoped `/find-booking` page
- Verify `/change-appointment`, `/fr/change-appointment`, and
  `/fr/nail-salon-no5/change-appointment` return `404`.
- Use a canonical `/manage/<token>` link or the tenant-scoped find-booking flow
  for reschedule and cancellation QA.
- Verify:
  - valid manage tokens preserve tenant context
  - cancel and reschedule do not require customer login
  - no browser request is made to `/api/auth/*`

## Unit / Route Tests

### Run the main suite
```bash
npm run test
```

### Typecheck
```bash
npm run check-types
```

Important:
- run `npm run build` before `npm run check-types` if `.next/types` is stale
- running both at the same time can cause `.next/types` race errors

## Playwright

### Recommended local command
```bash
npm run test:e2e:local
```

This uses:
- `HOST=localhost`
- `PORT=3101`
- Chromium only
- deterministic local OTP (`123456`) by blanking Twilio env vars for the Playwright server

### Core browser journeys only
```bash
npm run db:seed:e2e
npm run test:e2e:core:local
```

### Manual staging-like local browser run
```bash
npm run dev:e2e:local
E2E_BASE_URL=http://localhost:3101 npm run test:e2e:core:staging
```

See:
- [Browser E2E Gate](./E2E_STAGING.md)

### Default Playwright command
```bash
npm run test:e2e
```

Use this if your local `3000` port is free and you want the default config behavior.

## Known Local Gotchas

### Booking POST fails with missing appointment discount columns
- Run:
```bash
npm run db:migrate:development
```
- The guarded development command applies repository migrations. Do not manually
  patch or reset the dev database unless you are intentionally rebuilding it.

### Booking page says online booking is not ready
- Likely no active services for the current salon
- Run:
```bash
npm run db:seed:development
```

### Intentionally rebuild the Development database

Preview and Production are never accepted by this command. After reviewing the
target and accepting that all Development data will be removed, run:

```bash
LUSTER_DEVELOPMENT_RESET_CONFIRM=RESET_LUSTER_DEVELOPMENT_DATABASE \
  npm run db:reset:development
```

The reset re-attests the exact Development marker, recreates the schemas and
marker transactionally, then runs fixed migrate and synthetic-seed children.
See [Environment Separation](./ENVIRONMENT_SEPARATION.md) for provisioning and
credential handling.

### Playwright cannot start because port `3000` is busy
- Use:
```bash
npm run test:e2e:local
```

### `check-types` fails on missing `.next/types/...`
- Run:
```bash
npm run build
npm run check-types
```

### `next start`-backed Playwright fails with missing `.next/BUILD_ID`
- Prefer the dev-server-backed Playwright command for now:
```bash
npm run test:e2e:local
```
