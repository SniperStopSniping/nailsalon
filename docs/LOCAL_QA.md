# Local QA Guide

## Local App Boot

### 1. Install and migrate
```bash
npm install
npm run db:migrate:dev
```

### 2. Seed if needed
```bash
npm run db:seed
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

## Customer OTP / Booking QA

### OTP login
- Open a customer booking or confirm page with `?salonSlug=nail-salon-no5`
- Enter a phone number
- Submit or wait for auto-send
- Enter the code

Notes:
- If Twilio Verify is configured, OTP uses real SMS
- If Twilio is not configured in local dev, the dev verification fallback may accept `123456`

### Booking flow
- Go to:
  - `/book/service?salonSlug=nail-salon-no5`
  - `/profile?salonSlug=nail-salon-no5`
- Verify:
  - service selection carries `salonSlug`
  - time selection shows real availability
  - confirm only writes after explicit confirmation
  - success CTA routes are real

### Reschedule / cancel
- Start from `/profile?salonSlug=nail-salon-no5`
- Use `Manage booking`
- Verify:
  - `salonSlug` is preserved into `/change-appointment`
  - `locationId` is preserved when present
  - cancel returns to profile cleanly

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
- [docs/E2E_STAGING.md](/Users/me/Desktop/nail-salon-copy2 copy 2/docs/E2E_STAGING.md)

### Default Playwright command
```bash
npm run test:e2e
```

Use this if your local `3000` port is free and you want the default config behavior.

## Known Local Gotchas

### OTP verify says customer login storage is not ready
- Run:
```bash
npm run db:migrate:dev
```

### Booking page says online booking is not ready
- Likely no active services for the current salon
- Run:
```bash
npm run db:seed
```

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
