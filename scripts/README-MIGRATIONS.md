# Database Commands and Migrations

Repository SQL migrations remain forward-only under `migrations/`, but every
database-bearing Drizzle command must enter through a fixed package command.
`drizzle.config.ts` intentionally ignores ambient `DATABASE_URL`; invoking
`drizzle-kit migrate` or `drizzle-kit studio` directly therefore has no target.

## Non-Production setup

Development actions load only `.env.development.local`, then `.env.local`,
without overriding values already exported by the invoking process. Preview
actions load no dotenv file and require an explicit `APP_ENV=preview` process
environment. No action loads `.env`, `.env.development`, `.env.preview`, or
`.env.production`.

For an empty Development database:

```bash
npm run db:initialize:development
npm run db:migrate:development
npm run db:seed:development
npm run db:verify:development
```

For an empty Preview database, with its connection supplied by a one-process
Keychain wrapper that also exports `APP_ENV=preview`:

```bash
npm run db:initialize:preview
npm run db:migrate:preview
npm run db:verify:preview
```

Initialization is the only supported way to create
`public.luster_environment`; direct SQL is neither needed nor supported. The
initializer accepts an already-correct marker idempotently, and otherwise
creates it only after catalog inspection proves the database is empty.

Every later command performs two independent checks before mutation:

1. `DATABASE_URL` must use PostgreSQL and target loopback or an exact hostname
   in `LUSTER_NONPROD_DB_HOSTS`.
2. The connected database must have exactly one marker row equal to the fixed
   command environment (`development` or `preview`).

Hostnames, roles, connection strings, and credentials are never printed. After
provider provisioning, run `npm run env:verify` in a process containing the
complete application/provider environment to validate their mode without
opening a database connection. Database initialization itself needs only its
fixed application marker, URL, and exact host allowlist and performs independent
static and live database checks.

## Development data

`npm run db:seed:development` is Development-only. It does not run migrations,
does not fall back to PGlite, and creates only deterministic synthetic fixture
data, including the `dev-super-admin` identity used by the local role switcher.
The legacy `db:seed` name remains a Development-only alias for this same exact
marker-attested seed; it never selects Preview or Production.

To intentionally discard and rebuild Development data:

```bash
LUSTER_DEVELOPMENT_RESET_CONFIRM=RESET_LUSTER_DEVELOPMENT_DATABASE \
  npm run db:reset:development
```

The reset refuses a Preview marker. It attests Development first, transactionally
recreates `public`, `drizzle`, and the Development marker, then launches only the
fixed Development migrate and seed children. There is no generic Preview reset.

Development Studio is similarly marker-attested:

```bash
npm run db:studio:dev
```

## Production commands

Production operations remain separate and deliberate:

```bash
LUSTER_PRODUCTION_CONFIRM=YYYY-MM-DD npm run db:migrate:production
LUSTER_PRODUCTION_CONFIRM=YYYY-MM-DD npm run db:studio:production
```

The confirmation must equal the current local date. After confirmation, the
wrapper verifies that the live database does not carry a Development or Preview
marker, then passes the connection to Drizzle through the internal guarded
variable for that child process only. Production commands reject CI
unconditionally. Never store Production credentials in a local env file or
apply a Production migration as part of build or deploy.

The historical client-lifecycle migration uses the same date confirmation and
live Production marker exclusion outside CI:

```bash
LUSTER_PRODUCTION_CONFIRM=YYYY-MM-DD npm run db:migrate:client-lifecycle
```

In CI, that fixed alias accepts only a loopback PostgreSQL URL; a remote URL is
rejected before the migration child can start.

Do not invoke either Production command while performing PR-2 owner
provisioning. They are documented only for a separate, explicitly authorized
Production maintenance operation.

Special historical lifecycle migration and verification commands retain their
own documented safeguards. They are not substitutes for the fixed environment
commands above.

## Focused verification and repair tools

Schema verifiers and backfills are specialized engineering tools, not owner
provisioning steps. Run the relevant verifier after the guarded migration, use
dry-run modes where available, and retain each script's independent
non-Production marker checks. Do not bypass a guard with direct SQL.

If a verifier reports drift:

1. stop and confirm the exact environment with `db:verify:development` or
   `db:verify:preview`;
2. run the appropriate guarded migration command;
3. rerun the verifier;
4. do not reset a database merely to hide unexplained drift.

The owner-facing provisioning sequence and Vercel, Neon, Clerk, Stripe, and
Keychain scope tables are in
[`docs/ENVIRONMENT_SEPARATION.md`](../docs/ENVIRONMENT_SEPARATION.md).
