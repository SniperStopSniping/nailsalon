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
Run-scoped cleanup runs even on failure. It only deletes an exact matching
new user and captured newly-created organizations whose sole member is that
user. It refuses ambiguous or older identities; it never enumerates historical
test identities for deletion. A cleanup failure must be investigated using
the exact run scope, not a broader cleanup script.

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
