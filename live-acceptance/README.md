# Disposable Clerk acceptance

This is a real Clerk **Development-instance** signup and login journey against
an isolated local application. It is not a production smoke test and must never
target a deployed URL. It does not send email/SMS or use real Stripe credentials.
Use Node.js 20 and install the repository's locked dependencies first.

The external credential file must be named `.env.development` or
`.env.development.local`. The launcher reads only its Clerk key pair; database,
messaging, payment, and media credentials are not imported. The worktree must
have no local dotenv files. Never copy production credentials into this harness.

After any production build has finished using this worktree's `.next`, start:

```sh
LIVE_DEVELOPMENT_ENV_FILE=/absolute/path/to/.env.development \
  node --import tsx live-acceptance/run-local.ts server
```

Keep that process running. Copy its printed disposable runtime directory into
the test command (the directory contains PGlite, local media, and evidence):

```sh
LIVE_DEVELOPMENT_ENV_FILE=/absolute/path/to/.env.development \
LIVE_RUNTIME_DIR=/absolute/printed/luster-live-acceptance-directory \
  node --import tsx live-acceptance/run-local.ts test
```

The fixed target is `http://localhost:4211`. Each test run generates a new
`acceptance-<UUID>` identity. Clerk's official testing token and `+clerk_test`
address use the test verification code without sending verification email.
Passwords are generated in memory. Auth traces are disabled because they can
retain passwords or session material. Evidence is outside the repository.

After the expected unknown-email sign-in lookup, the browser test reloads
Clerk's public client resource through the unmodified official testing helper
and checks that the helper is ready before submitting signup. Clerk's error
responses can carry `meta.client`, which its current helper does not normalize.
This compatibility step exists only in the disposable browser harness; it does
not change the application, provider configuration, or CAPTCHA protection.
Diagnostics retain only status codes and allowlisted booleans, not raw provider
responses. See the [official helper source](https://github.com/clerk/javascript/blob/main/packages/testing/src/playwright/setupClerkTestingToken.ts)
and [client resource handling](https://github.com/clerk/javascript/blob/main/packages/clerk-js/src/core/resources/Client.ts).

The main journey checks real account creation, verification, an early claim,
saved media, a second claim with services/about/layout/policies, the free-plan
handoff, dashboard reload, sign-out, fresh-browser sign-in, saved preview,
explicit local publication, and unauthenticated public booking start. Local
publication changes only the disposable database; it is not a deployment.
Identities are retained by default, with run-scoped cleanup targets journaled
outside the repository in a mode-0600 file (no passwords or tokens). Cleanup
requires explicit user consent for irreversible deletion and an exact matching
`LIVE_CLERK_CLEANUP_CONFIRMED=<run ID>` after the operator has checked provider
permissions. It only deletes that new user and captured newly-created
organizations whose sole member is that user. It refuses ambiguous or older
identities and never enumerates historical identities for deletion. A cleanup
failure must be investigated using that exact run scope, not a broader script.

Safety tests need no credentials or running application:

```sh
node --import tsx --test live-acceptance/safety.node-test.ts live-acceptance/clerk-diagnostics.node-test.ts
```

The former unscoped captcha probe, historical-user tail journey, and dotenv
global setup have been retired. The current Clerk token setup is a Playwright
project dependency so its token is available to the dependent browser project.
To verify token/FAPI propagation without starting or navigating to the app, use
the same launcher environment with `test-setup` instead of `test`. It records
presence booleans only, never token values.

## Optional disposable loopback PostgreSQL

When file-backed PGlite is unstable across Next development compilation, an
operator may initialize a new local PostgreSQL cluster using the guarded
Development initializer/migrations. Do not use a hosted database or copy data.
Both server and test commands must receive the same explicit `LIVE_RUNTIME_DIR`
and `LIVE_RUN_SUFFIX`, plus `LIVE_LOCAL_POSTGRES_CONFIRMED=true` and
`LIVE_LOCAL_POSTGRES_URL`. The URL must use localhost/127.0.0.1 port 55441 with
database and role both equal to `luster_acceptance_` followed by the first 16
hex characters of SHA-256 of the run ID. Query strings are rejected. The normal
runtime database guard must additionally verify the Development marker.
The launcher never imports `DATABASE_URL` from dotenv or the parent environment.
