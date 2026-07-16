# Luster Free Booking

Luster is a Canada-first booking and client workspace for independent nail techs. Salon owners manage appointments, services, clients, availability, and optional Google Calendar synchronization. Clients book as guests and manage reservations through private email links—no account or phone verification is required.

Production: [islanailsalon.com](https://islanailsalon.com)

## Product boundaries

- Solo nail techs are the primary audience.
- Email/password owner authentication is provided by Clerk.
- Customers book without accounts or OTP.
- Google Calendar is optional; selected busy calendars prevent double-booking.
- Twilio is optional, salon-funded, consent-based customer messaging only.
- Luster appointments remain the source of truth for CRM and reporting.
- Imported Google busy time never affects revenue, reminders, or client history unless the owner converts it to an appointment.

## Local development

Use Node.js 20 and install dependencies:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Runtime credentials belong only in ignored local environment files or deployment secret stores. Never commit real credentials.

## Quality gates

```bash
npm run check-types
npm run lint
npm run test:all
npm run build
npm run security:check-secrets
```

Core browser journeys can be run with:

```bash
npm run test:e2e:core:local
```

The E2E runner requires its Clerk testing token, isolated test database, Redis, and runtime-only test credentials.

## Database migrations

Migrations are stored in [`migrations`](./migrations) and applied through Drizzle:

```bash
npm run db:migrate:dev
```

Production migrations must be executed with the production database secret loaded at runtime and only after a verified backup. Operational cleanup scripts default to dry-run.

## Production operations

- `/api/health` exposes a secret-free health summary for external monitoring.
- `/en/super-admin/system` provides authenticated production readiness and job health.
- Integration outbox jobs are tenant-scoped, idempotent, retried with backoff, and recover abandoned claims.
- Questionable production salons are moved to draft for review; cleanup tools do not delete appointment data.
- Production test tools are disabled server-side.

## Support

Luster support: [support@islanailsalon.com](mailto:support@islanailsalon.com)
