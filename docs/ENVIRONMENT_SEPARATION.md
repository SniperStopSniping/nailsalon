# Environment Separation Owner Runbook

This runbook is the operations handoff for Development, Preview, and Production.
The repository supplies fail-closed engineering controls; creating provider
resources and assigning Console scopes remains an owner task. No direct SQL is
required at any point. The numbered sections are reference material; perform
the ordered sign-off checklist in section 7.

## Safety contract

| Environment | Database | Clerk | Stripe | Application markers |
| --- | --- | --- | --- | --- |
| Local Development | Empty Development database, or no URL for in-memory PGlite | Development instance | Test mode | `APP_ENV=development`; database row `development` |
| Vercel Preview | Empty, dedicated Preview database | Development instance | Test mode | `VERCEL_ENV=preview`; `APP_ENV=preview`; database row `preview` |
| Production | Existing Production database | Production instance | Live mode | `VERCEL_ENV=production`; `APP_ENV=production` |

Production credentials must be scoped to Vercel Production only. Development
and Preview must never inherit the Production database URL, Clerk keys, Stripe
keys, webhook secret, or billing-plan mode. Do not clone Production customer
data into either non-Production database.

The database marker is authoritative after connection. An allowlisted hostname
alone never authorizes mutation. Development commands reject a Preview marker,
Preview commands reject a Development marker, and both reject Production or an
unmarked non-empty database.

## 1. Neon

In the Neon Console:

1. Create empty, independent Development and Preview databases outside the
   Production Neon project. They may use separate non-Production projects or a
   shared non-Production project, but must not share a project, branch, role,
   database, or data with Production. Do not branch from Production or import
   Production data.
2. Create a separate application role and password for each. Do not reuse the
   Production role. If runtime and provisioning roles are split, use the
   database-owner connection only inside the supervised initialization and
   migration commands below; give Vercel the environment-specific runtime role.
3. Record each connection in macOS Keychain without copying it into a tracked
   file, issue, PR, chat, or shell history.
4. Independently record every exact endpoint hostname used by the selected
   environment. If Neon supplies different direct/provisioning and
   pooled/runtime hosts, include both environment-specific hosts in
   `LUSTER_NONPROD_DB_HOSTS`. It accepts comma-separated exact hostnames only—no
   scheme, wildcard, port, path, query, user, or password.
5. From this repository commit, use the fixed initializer. It creates the
   marker only on a catalog-empty database and is idempotent for the already
   correct marker. The supervised wrapper must export `DATABASE_URL`,
   `LUSTER_NONPROD_DB_HOSTS`, and the fixed `APP_ENV` for the selected
   environment to each one-process command; never paste a URL into a command.

Development sequence:

```bash
npm run db:initialize:development
npm run db:migrate:development
npm run db:seed:development
npm run db:verify:development
```

Preview sequence (`APP_ENV=preview` is supplied by the supervised wrapper):

```bash
npm run db:initialize:preview
npm run db:migrate:preview
npm run db:verify:preview
```

Never use the generic Drizzle CLI or enter marker SQL in Neon. If initialization
rejects a non-empty target, stop and investigate; do not empty it merely to make
the guard pass. Initialization and migrations need a role capable of creating
the repository schema; the application runtime role should have only the
permissions the deployed application needs.

## 2. macOS Keychain

Use Keychain Access to create separate generic-password items. The owner
wrapper must select each item by both its exact service and account labels:

| Keychain service label | Account label | Exported variable | Environment |
| --- | --- | --- | --- |
| `luster-development-database-url` | `luster-development` | `DATABASE_URL` | Development only |
| `luster-preview-database-url` | `luster-preview` | `DATABASE_URL` | Preview only |
| `luster-development-clerk-secret` | `luster-development` | `CLERK_SECRET_KEY` | Development only |
| `luster-preview-clerk-secret` | `luster-preview` | `CLERK_SECRET_KEY` | Preview only |
| `luster-development-stripe-secret` | `luster-development` | `STRIPE_SECRET_KEY` | Development only |
| `luster-preview-stripe-secret` | `luster-preview` | `STRIPE_SECRET_KEY` | Preview only |
| `luster-development-stripe-webhook` | `luster-development` | `STRIPE_WEBHOOK_SECRET` | Development only |
| `luster-preview-stripe-webhook` | `luster-preview` | `STRIPE_WEBHOOK_SECRET` | Preview only |

Enter values through Keychain Access rather than a command argument, which
could persist in shell history.

For supervised commands, keep a mode-`0700` owner wrapper outside the repository.
It should disable tracing, retrieve exactly one environment's items with
`/usr/bin/security find-generic-password -s '<fixed-service-label>' -a
'<fixed-account-label>' -w`, export them only to the one child process, invoke
one fixed npm action, and unset them in an exit trap. Both selectors must come
from a hard-coded action mapping, never caller input. The wrapper must accept
only the fixed Development or Preview actions documented here; it must never
accept a raw command, environment name, URL, hostname, or variable name from
free-form input, and it must never print a retrieved value.

For Development actions, the repository wrapper loads
`.env.development.local` first and then `.env.local`, both without override.
Therefore values exported by the owner wrapper win. Preview actions load no
dotenv file and require the wrapper to export `APP_ENV=preview`; no Preview or
Production dotenv file is loaded implicitly. The wrapper also supplies the
reviewed constant host allowlist. A separate allowlisted `env:verify` action
must export the selected environment's complete provider set: `APP_ENV`,
`BILLING_PLAN_ENV`, `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET`. That command
does not connect to a database. Store the non-secret `APP_ENV`,
`BILLING_PLAN_ENV`, publishable keys, and reviewed hostname allowlist as fixed
per-action constants in the mode-`0700` wrapper; do not accept them as command
arguments.

## 3. Local environment files

1. Copy `.env.example` to `.env.development.local`.
2. Keep `APP_ENV=development` and `BILLING_PLAN_ENV=dev`.
3. Use Clerk Development-instance and Stripe test-mode keys only.
4. For loopback PostgreSQL, leave `LUSTER_NONPROD_DB_HOSTS` empty. For hosted
   Development, set it to only the independently reviewed Development hostname.
5. Keep `DEV_SUPER_ADMIN_ID=dev-super-admin`; the guarded seed creates that
   synthetic row.
6. Restrict the file to the local user with
   `chmod 600 .env.development.local`. Confirm
   `git check-ignore .env.development.local` succeeds before adding any value.
7. Never set `VERCEL_ENV` locally and never copy a Vercel Production env dump.

`.env.local` is a fallback for existing setups. New setup belongs in
`.env.development.local`. All runtime dotenv files are ignored, but ignored is
not encrypted—prefer Keychain for database and provider secrets.

## 4. Vercel scopes

Review every variable in the Vercel Console. Do not rely on an existing
all-environments assignment.

First create or select one stable Vercel Preview branch/domain alias and record
its hostname as the reviewed Preview host. Use that same alias for Vercel
`NEXT_PUBLIC_APP_URL`, Clerk, and Stripe. Do not provision providers against an
ephemeral per-commit deployment URL.

| Variable | Development | Preview | Production |
| --- | --- | --- | --- |
| `APP_ENV` | `development` | `preview` | `production` |
| `NEXT_PUBLIC_APP_URL` | Local origin | Stable reviewed Preview origin | Production origin |
| `DATABASE_URL` | Development only, if needed | Preview only | Production only |
| `LUSTER_NONPROD_DB_HOSTS` | Exact Development host | Exact Preview host | Unset |
| `CLERK_SECRET_KEY` | Development instance | Development instance | Production instance |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Development instance | Development instance | Production instance |
| `STRIPE_SECRET_KEY` | Test mode | Test mode | Live mode |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Test mode | Test mode | Live mode |
| `STRIPE_WEBHOOK_SECRET` | Local test endpoint | Preview test endpoint | Production live endpoint |
| `BILLING_PLAN_ENV` | `dev` | `test` | `prod` |

Vercel supplies `VERCEL=1` and `VERCEL_ENV`; do not define either one manually.
The runtime trusts a Vercel deployment only when those platform values and the
matching owner-scoped `APP_ENV` are all present. After correcting scopes,
inspect the Preview configuration by variable name and scope only—never copy
values into a ticket or PR. Redeployment and Console changes are separate owner
operations and are not performed by this engineering PR.

Cron and integration credentials are outside this PR. Do not add Google
Calendar credentials while performing environment separation.

## 5. Clerk

1. Use Clerk's Development instance for Local Development and Vercel Preview.
2. Use the Clerk Production instance only in Vercel Production.
3. Scope both the secret key and publishable key together; never mix modes.
4. Add only the intended localhost and Preview origins/redirects to the
   Development instance. For Preview, allow the single stable reviewed HTTPS
   origin above, set `CLERK_AUTHORIZED_PARTIES` to that origin, and register the
   repository's owner-auth return paths for both supported locales:
   `/en/owner-sign-in`, `/fr/owner-sign-in`, `/en/owner-sign-up`, and
   `/fr/owner-sign-up`. Do not add wildcard or per-commit Preview hosts.
5. Create synthetic Development users where interactive auth QA requires them.
   Do not copy Production users or Production Clerk IDs into non-Production.
6. Keep the Production keys out of local files, Keychain items named for
   non-Production, and Vercel Preview scope.

The engineering guard validates key mode and pairing. Provider Console review
is still required because a key prefix cannot prove which Clerk application an
owner selected.

## 6. Stripe test mode

1. Enable test mode and create non-Production API keys.
2. Create the Preview test webhook endpoint at
   `https://<the-stable-reviewed-preview-host>/api/webhooks/stripe` and keep its
   signing secret separate from Production. Subscribe it only to the existing
   subscription-billing events: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_succeeded`, and
   `invoice.payment_failed`. Use a separate local test webhook secret for local
   tooling.
3. Scope test secret/publishable key pairs and webhook secrets only to
   Development/Preview.
4. Keep `BILLING_PLAN_ENV=dev` locally and `test` in Preview.
5. Keep live keys, the live webhook secret, and `BILLING_PLAN_ENV=prod` in
   Vercel Production only.

This provisioning isolates existing subscription-billing providers. It does
not enable deposits, change checkout logic, create charges, or modify payment
records.

## 7. Verification and sign-off

Before onboarding an external salon, perform this sequence in order and confirm:

- [ ] Create Development and Preview Neon resources outside the Production
  project, with distinct roles, URLs, and no Production-derived data.
- [ ] Create the separate Clerk Development and Stripe test-mode resources,
  including the Preview subscription-billing webhook.
- [ ] Store the environment-specific secrets in Keychain and prepare the fixed,
  external owner wrapper; place only reviewed non-secret local values in the
  ignored mode-`0600` Development file.
- [ ] Audit every exact Vercel variable above and correct its environment scope.
- [ ] Run `npm run env:verify` in each fully populated non-Production process
  scope; it must pass before that environment is released.
- [ ] Run the fixed initialize, migrate, optional Development seed, and verify
  sequences against their empty databases; do not invoke any Production
  database command during PR-2 provisioning.
- [ ] `db:verify:development` passes only against Development.
- [ ] `db:verify:preview` passes only against Preview.
- [ ] Swapping either URL causes an exact-marker rejection.
- [ ] Vercel Preview has no Production-scoped database or provider credential.
- [ ] Local files and Keychain contain no Production credential.
- [ ] Clerk Development/Production instances are separated.
- [ ] Stripe test/live modes and webhook secrets are separated.
- [ ] CI uses only its disposable loopback PostgreSQL service.
- [ ] Production database commands reject CI even when invoked directly.
- [ ] Secret scans pass and no connection string was printed or committed.
- [ ] No Google Calendar, deposit, booking-flow, or Production operation was
  performed as part of this provisioning.

The Development reset is intentionally destructive and remains Development-only:

```bash
LUSTER_DEVELOPMENT_RESET_CONFIRM=RESET_LUSTER_DEVELOPMENT_DATABASE \
  npm run db:reset:development
```

There is no generic Preview reset and no owner provisioning step requires SQL.
