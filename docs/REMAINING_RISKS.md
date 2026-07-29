# Remaining Risks

## Production / Ops

### Strict Sentry production env dependency
- Files:
  - [next.config.mjs](/Users/me/Desktop/nail-salon-copy2 copy 2/next.config.mjs)
  - [src/libs/sentry/build.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/sentry/build.ts)
- Current behavior:
  - production builds hard-fail if the required Sentry env vars are missing
- Risk:
  - deployments fail closed until monitoring env is configured correctly
- Current stance:
  - intentional and good for production safety, but still an operational dependency

### Auto-posting worker not enabled by default
- Files:
  - [vercel.json](/Users/me/Desktop/nail-salon-copy2 copy 2/vercel.json)
  - [src/app/api/autopost/process/route.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/api/autopost/process/route.ts)
- Current behavior:
  - reminders cron is active
  - autopost cron is not currently wired in `vercel.json`
- Risk:
  - salons can enqueue autopost jobs but nothing processes them until a cron is configured

## Browser QA

- Browser specs exist, but the highest-value production journeys still need repeated clean browser passes:
  - service -> time -> confirm transitions
  - canonical manage link -> reschedule -> cancel
  - admin and staff operational flows
- Client PR 0B1 removes the active `/change-appointment` confirmation fallback
  and the unreachable booking floating dock.
- Live verification of a successful booking and valid manage token still
  requires an approved disposable fixture. The focused customer-journey E2E
  uses intercepted responses where that fixture is unavailable and must be run
  explicitly because it is not part of the default hosted E2E pattern.

## Retired Customer UI Follow-ups

- Client PR 0B2 still needs to retire the remaining profile, history,
  preferences, rewards, gallery, invite, membership, my-referrals,
  payment-methods, and referral route surfaces.
- `BookingPhoneLogin`, `BlockingLoginModal`, and `BookingFloatingDock` remain as
  intentionally unreferenced source in 0B1.
- A future customer account, emailed OTP, secure session, and My Bookings
  architecture is not implemented by 0B1.

## Productization Gaps

### Self-serve onboarding is still operator-driven
- Current behavior:
  - the app supports multi-tenant salons, billing primitives, feature gating, and super-admin controls
  - onboarding a new salon still relies heavily on manual setup and operator knowledge
- Risk:
  - acceptable for founder-led / managed launch
  - not yet ideal for low-touch self-serve SaaS acquisition

### Generic boilerplate/documentation residue still exists
- Files:
  - [README.md](/Users/me/Desktop/nail-salon-copy2 copy 2/README.md)
  - various legacy boilerplate references across docs
- Risk:
  - weakens buyer confidence and makes the product feel less packaged than it really is

## Dev / Demo Assumptions

### Local fallback/demo behavior still exists
- Files:
  - [src/libs/DB.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/DB.ts)
  - [src/libs/devRole.server.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/devRole.server.ts)
  - [src/app/api/dev/role/route.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/api/dev/role/route.ts)
- Current behavior:
  - dev-only role overrides and PGlite fallback still exist for local development
- Risk:
  - useful for development, but they are still visible signs that the repo originated as an internal/rapid-build platform rather than a fully polished packaged SaaS

## Local Test Infra

- Local Playwright verification still prefers a dev-server-backed run.
- The environment has had prior `next start` / build-artifact verification inconsistencies, so production-style browser verification is not yet as repeatable as it should be.
