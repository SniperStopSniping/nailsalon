# Runtime Architecture

## Auth and Sessions

### Customer
- Session cookie: `client_session`
- Storage model: opaque server-backed session row in `client_session`
- Restore path: `GET /api/auth/validate-session`
- Login path: `POST /api/auth/send-otp` -> `POST /api/auth/verify-otp`
- Active UI hook: [useClientSession.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/hooks/useClientSession.ts)
- Notes:
  - Customer auth no longer trusts URL phone params.
  - Legacy helper cookies are cleanup-only and should not be used for auth decisions.

### Staff
- Session cookie: `staff_session`
- Storage model: opaque server-backed session row in `staff_session`
- Restore path: `GET /api/staff/me`
- Login path: `POST /api/staff/send-otp` -> `POST /api/staff/verify-otp`
- Shared guard entrypoint: [staffApiGuards.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/staffApiGuards.ts)

### Admin
- Session cookie: `n5_admin_session`
- Storage model: opaque server-backed session row in `admin_session`
- Primary guard helpers:
  - `requireAdmin(salonId)`
  - `requireActiveAdminSalon()`
- Source: [adminAuth.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/adminAuth.ts)

## Tenant Resolution

- Primary tenant key: `salonSlug`
- Resolution order:
  1. explicit `salonSlug` query param
  2. persisted `__active_salon_slug` httpOnly cookie
- Main helpers:
  - `resolveSalonSlug()`
  - `getResolvedSalon()`
  - `requireResolvedSalon()`
  - `getPublicPageContext()`
- Source: [tenant.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/tenant.ts)

### Active Salon for Admin
- Multi-salon admin routes should resolve against the active salon, not the first membership.
- Current shared helper: `requireActiveAdminSalon()`
- Source: [adminAuth.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/adminAuth.ts)

## Route Guard Model

### Customer API guards
- Shared helpers live in [clientApiGuards.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/clientApiGuards.ts)
- Pattern:
  - require authenticated customer session
  - bind reads/writes to session identity
  - resolve tenant from `salonSlug` or active tenant cookie

### Staff API guards
- Shared helpers live in [staffApiGuards.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/staffApiGuards.ts)
- Pattern:
  - require authenticated staff session
  - enforce same-salon access
  - optionally enforce assigned-only appointment access

### Mixed appointment access guards
- Shared helpers live in [routeAccessGuards.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/routeAccessGuards.ts)
- Used for routes where access can come from:
  - owning customer session
  - assigned technician
  - salon admin

## Booking Policy and Availability

- Shared booking policy source: [bookingPolicy.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/bookingPolicy.ts)
- Shared rules now apply to both:
  - `GET /api/appointments/availability`
  - `POST /api/appointments`

### Current booking rules
- service duration affects slot fit
- 10-minute cleanup buffer between appointments
- weekly technician schedule enforcement
- schedule override hours / override off-days
- technician time off
- technician blocked slots / lunch breaks
- technician service capability enforcement
- location compatibility and location business hours
- reschedule checks exclude the original appointment from self-conflict

### Important implementation detail
- Availability and writes both use the same policy helper.
- The write path still performs a fresh policy check before insert.

## Frontend Flow Contracts

### Customer booking
- Booking URLs should be built with [bookingParams.ts](/Users/me/Desktop/nail-salon-copy2 copy 2/src/libs/bookingParams.ts)
- Required context to preserve:
  - `salonSlug`
  - `serviceIds`
  - `techId`
  - `locationId` when present
  - `originalAppointmentId` for reschedules

### Staff/admin UI
- Shared UI shells now live under `src/components/ui` plus `src/components/staff` and `src/components/admin`.
- Recently cleaned-up page composition:
  - [src/app/[locale]/(auth)/staff/appointments/page.tsx](/Users/me/Desktop/nail-salon-copy2 copy 2/src/app/[locale]/(auth)/staff/appointments/page.tsx)
  - [src/components/admin/TimeOffRequestsInbox.tsx](/Users/me/Desktop/nail-salon-copy2 copy 2/src/components/admin/TimeOffRequestsInbox.tsx)
