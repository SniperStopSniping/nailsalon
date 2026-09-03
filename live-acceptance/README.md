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

The main journey checks real account creation, verification, an early claim,
saved media, a second claim with services/about/layout/policies, the free-plan
handoff, dashboard reload, sign-out, fresh-browser sign-in, saved preview,
explicit local publication, and unauthenticated public booking start. Local
publication changes only the disposable database; it is not a deployment.
Run-scoped cleanup runs even on failure. It only deletes an exact matching
new user and captured newly-created organizations whose sole member is that
user. It refuses ambiguous or older identities; it never enumerates historical
test identities for deletion. A cleanup failure must be investigated using
the exact run scope, not a broader cleanup script.

Safety tests need no credentials or running application:

```sh
node --import tsx --test live-acceptance/safety.node-test.ts
```

The former unscoped captcha probe, historical-user tail journey, and dotenv
global setup have been retired. The current Clerk token setup is a Playwright
project dependency so its token is available to the dependent browser project.
