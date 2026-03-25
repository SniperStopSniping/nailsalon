# Remaining Risks

## Booking / Domain

### Non-transactional reschedule
- File: [src/app/api/appointments/route.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/api/appointments/route.ts)
- Current behavior:
  - create the replacement appointment
  - cancel the original appointment afterward
- Risk:
  - partial failure can leave duplicate or mismatched state
  - concurrent writes can still race

## Remaining Route Outliers

### Customer
- [src/app/api/client/reviews/route.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/api/client/reviews/route.ts)
  - still uses direct `getClientSession()` instead of the newer shared client guard layer

### Admin
- [src/app/api/admin/fraud-signals/route.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/api/admin/fraud-signals/route.ts)
- [src/app/api/admin/fraud-signals/[id]/resolve/route.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/api/admin/fraud-signals/[id]/resolve/route.ts)
  - not part of the last active-salon guard cleanup pass

### Staff namespace/path drift
- [src/app/api/staff/time-off/route.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/api/staff/time-off/route.ts)
- [src/app/api/staff/time-off/[id]/route.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/api/staff/time-off/[id]/route.ts)
  - active but pathing is stale and misleading relative to current authorization patterns

## E2E / Browser Gaps

- Browser specs now exist in [tests/e2e/customer-journeys.e2e.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/tests/e2e/customer-journeys.e2e.ts)
- Current gap:
  - browser execution still needs a clean local Next/Playwright run
- Highest-value paths still needing a confirmed browser pass:
  - OTP login on customer booking confirmation
  - time selection -> confirm transition
  - profile -> reschedule -> cancel
  - admin/staff browser flows beyond unit/component tests

## Demo / Dev Assumptions Still Present

### Runtime-adjacent demo assumptions
- [src/libs/DB.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/DB.ts)
  - PGlite fallback seeds `nail-salon-no5`
- [src/libs/devRole.server.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/devRole.server.ts)
  - dev-role behavior still exists for local dashboards
- [src/theme/themes.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/theme/themes.ts)
- [src/models/Schema.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/models/Schema.ts)
  - theme defaults still assume the `nail-salon-no5` tenant

### Explicit dev route/API still present
- [src/app/api/dev/role/route.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/api/dev/role/route.ts)

## Local Test Infra Risk

- In this environment, `next build` succeeded but `.next/BUILD_ID` was not present afterward, which prevented `next start`-backed Playwright verification.
- Prefer local dev-server-backed Playwright runs for now until the production-start issue is understood.
