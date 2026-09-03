# Launch readiness — September 3, 2026

## Verdict

The existing production service responded healthily, but the new account-backed
Onboarding V1 flow is **not ready for an unrestricted public launch**. Local
preview quality and passing unit tests do not establish production readiness.
This report covers the bounded readiness audit, not every check performed by
other work on the branch.

## What was actually checked

- Read-only production requests to `https://islanailsalon.com` returned `200`
  for the homepage, owner sign-in, and Isla's service-booking page.
- At `2026-09-03T21:39:56Z`, `/api/health` returned `200`, `status: ok`, and
  deployed Git SHA `35125b2`. Database, Redis, Clerk configuration, password
  authentication configuration, verified Resend sender, Stripe/Connect
  configuration, Sentry configuration, and Google Calendar configuration were
  reported available. Lifecycle, deposits, and schema-drift statuses were
  `ready`. Provider configuration flags are not successful payment, delivery,
  webhook, or sign-in tests.
- Production `/onboarding-v1` redirected to `/en/owner-sign-in`; `/pricing`
  returned `404`. The new anonymous onboarding entry point was not shown.
- The audited local branch started at `f177902`, not the deployed SHA, and
  includes the follow-up changes recorded with this report. Its local app at
  `http://localhost:4201` uses disposable PGlite. Local health reported a working
  database and ready schemas, but `503` because hosted integrations are absent.
- A local unauthenticated request to the onboarding Workspace API returned
  `401`; an unknown private media identifier returned `404`.
- No production account, booking, database, messaging, billing, deployment, or
  feature-flag mutation was made by this audit.

## Release blockers and scope limits

1. **Onboarding media is still development-only.**
   `src/features/onboarding-v1-integration/media-storage.server.ts:58` rejects
   `NODE_ENV=production` with `IMAGE_STORAGE_UNAVAILABLE`. The media route calls
   this adapter and records `storageProvider: development_local`. The separate
   Cloudinary profile projection does not replace the private revision-owned
   media adapter. A production-safe, tenant-scoped storage adapter and its
   upload/read/retry/purge verification are required before promising durable,
   cross-device photos in this flow. Do not remove the safety guard as a fix.
2. **This release's schema and feature activation are not production-verified.**
   The branch adds migration `0074_onboarding_account_site_foundation`; the
   deployed `35125b2` migration journal ends at `0073`. Existing production
   health therefore cannot attest to this branch's schema. Follow the guarded
   database/release workflow for the exact reviewed commit; no migration was
   attempted here. Onboarding V1 is also dark by default behind
   `LUSTER_ONBOARDING_V1_INTEGRATION_ENABLED`.
3. **Paid self-service onboarding is not implemented by the plan picker.**
   `saveOnboardingPlanIntent` stores a free/founding/monthly interest choice,
   not a subscription, entitlement, or checkout. The UI says these are upcoming
   plans and that nothing is charged. This can fit an explicitly free beta, but
   it is not evidence for a paid launch. Existing billing infrastructure must
   be verified separately before paid promises are made.
4. **End-to-end release acceptance remains incomplete.**
   Current-commit Clerk signup, verified-email claim, organization completion,
   logout/login, cross-browser recovery, durable images, publish-to-customer
   rendering, and real isolated guest booking/manage/reschedule/cancel have not
   been established by this audit. The default owner browser tests use
   super-admin impersonation. The separate `live-acceptance` harness creates
   Clerk development users/organizations, has dated selectors and no target
   guard, and its cleanup matches historical test identities. It was not run;
   scope it to an isolated target and exact per-run identities before reuse.

## Check results from this audit

- `npx eslint tests/e2e/customer-journeys.e2e.ts` — passed.
- The initial six-test guest browser suite had five passes and one ambiguous
  status-region selector failure. The assertion was scoped to the missing-link
  notice, preserving the actual recovery assertion. The final no-retry run of
  `E2E_BASE_URL=http://localhost:4201 npx playwright test
  tests/e2e/customer-journeys.e2e.ts --project=chromium --no-deps --retries=0`
  finished with **four passed, two failed**. Guest confirmation, missing-link
  recovery, time selection, and mobile technician selection passed. The two
  retired-route tests encountered `net::ERR_ABORTED` on French tenant-prefixed
  routes. Direct GETs to the affected URLs returned `404`; browser traces show
  the navigation was aborted before its response, after preceding routes
  returned `404`. The cause remains unproven and the browser gate is not green.
- `npm run security:check-secrets` — failed closed on three oversized generated
  development bundles, not on a reported credential match. The scanner's limit
  is 5 MiB; the affected onboarding layout, onboarding page, and main-app
  bundles were approximately 8.1, 10.3, and 5.8 MiB. Do not raise the limit or
  exclude them to obtain a green result. Repeat on the isolated release-build
  client output.
- Production build, complete lint/type/unit gates for the final combined
  changes, exact-SHA Preview browser acceptance, and production migration
  readiness for `0074` were not run by this audit. No build was run against the
  shared dev server's `.next` directory.
- `git diff --check` for this report and the scoped browser-test change —
  passed. The supplied development credential source was checked without
  displaying values: Clerk publishable and secret keys are test-mode; no
  preconfigured testing token was present. No Clerk acceptance run was made.

## Next release gate

Finish the production media adapter, then use one reviewed commit and an
isolated non-production environment to run the complete account → save →
reopen → publish → guest booking → manage/reschedule/cancel journey, including
mobile WebKit. Verify paid billing and outbound messages separately if they
are part of launch. Build and scan that exact release, pass the required CI and
Preview checks, and only then follow the documented migration and protected
`main` deployment process. Recheck production health and the expected Git SHA
after release.

## Follow-up implementation and focused verification

- The review homepage now has a primary **Build my website** entry and a
  secondary **Open owner dashboard** entry. It uses the existing integration
  flag, so disabled environments do not advertise an unavailable setup route.
  English and French copy and customer-salon redirects are covered by six
  passing component/route tests.
- City and full address remain adjacent, vertically stacked, full-width fields
  on both desktop and mobile. Six Chromium checks passed: homepage → Quick
  Book → identity → first preview → location/reload at 320×568, 375×667,
  390×844, 430×932 and 1180×800, plus French homepage layout at 320×568.
  A headed 390px browser journey and desktop visual inspection also passed.
- The existing mobile audit suite passed all eight Chromium journeys. Four
  exercise the real Next app through the account reward; four exercise the
  isolated prototype from service selection through the final preview/paywall.
  This is not evidence of a real Clerk signup, payment, or guest booking.
- The full shared Product service/add-on template library is now available in
  onboarding, keeping existing draft IDs, starter selections, overrides and
  existing service images. Selection still uses the real tenant-scoped claim
  path. Anonymous onboarding does **not** fetch an existing salon's custom
  service records, prices or uploads; those records remain preserved on claim.
- Google Places autocomplete is not configured or implemented by this pass.
  It requires an approved Places-enabled Google project and restricted key.
  The existing manually entered location and shared public privacy resolution
  remain the source for customer map/directions behavior.
- `npm run check-types` and focused ESLint for the new homepage, localization,
  route tests and browser checks passed. `npm test` ran its committed-change
  selection and passed 29 tests; new tests were also run explicitly because
  that command does not include all uncommitted changes.
- The complete onboarding integration test directory passed **170 tests**.
  The focused catalogue/save/preview run passed 87 tests (overlapping that
  directory), including full-catalogue claim, a price override, add-on
  compatibility, existing tenant-menu preservation and wrong-owner denial.
  Inherited compiler assertions were corrected to expect the already-approved
  shared Quick Book Visit & Contact section; privacy and ownership assertions
  remain intact. Focused lint passed for every changed Product TypeScript file.
- The final bounded prototype suite passed **1,224/1,224 tests across 111
  files**. Prototype typecheck and build passed; the build retains its existing
  large-chunk advisory. This build does not replace a Next production build.
- The broader `npm run lint` gate failed with 2,284 errors and 129 warnings in
  the selected existing prototype/account coverage. This is not a green
  release gate, even though focused checks pass. No unrelated formatting sweep
  was performed.
- The review homepage and existing service-image URL returned HTTP 200 over
  the local/LAN review server. Production was not changed.
