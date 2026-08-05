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
cp .env.example .env.development.local
npm run dev
```

Replace the provider placeholders with Clerk Development-instance and Stripe
test-mode credentials before starting. With `DATABASE_URL` blank, local
Development uses isolated in-memory PGlite. Follow the guarded sequence below
when persistent PostgreSQL is needed.

Use only Clerk Development-instance and Stripe test-mode credentials locally.
Runtime credentials belong only in ignored local environment files, macOS
Keychain, or deployment secret stores. Never commit real credentials. See the
[environment separation runbook](./docs/ENVIRONMENT_SEPARATION.md) before
configuring a hosted Development or Preview database.

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
npm run db:initialize:development
npm run db:migrate:development
npm run db:seed:development
```

Initialization creates the guarded in-database Development marker without
requiring direct SQL. The legacy `db:seed` name is a Development-only alias for
the same exact-marker command. Direct database-bearing Drizzle commands are
retired; use only the guarded package commands.

Production migrations use `npm run db:migrate:production`, with the production
database secret loaded only for that invocation and
`LUSTER_PRODUCTION_CONFIRM` set to the current local date. Run them only after a
verified backup. Operational cleanup scripts default to dry-run.

## Production operations

- `/api/health` exposes a secret-free health summary for external monitoring.
- `/en/super-admin/system` provides authenticated production readiness and job health.
- Integration outbox jobs are tenant-scoped, idempotent, retried with backoff, and recover abandoned claims.
- Questionable production salons are moved to draft for review; cleanup tools do not delete appointment data.
- Production test tools are disabled server-side.

## Support

Luster support: [support@islanailsalon.com](mailto:support@islanailsalon.com)
