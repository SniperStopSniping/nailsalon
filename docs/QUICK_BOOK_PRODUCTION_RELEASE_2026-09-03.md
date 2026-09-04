# Quick Book production release checkpoint

This release follows the approved onboarding flow; it does not redesign it.
The original readiness audit is historical. This checkpoint records the
subsequent release work and does not claim that production has been updated.

## Implemented release fixes

- Durable, authenticated Cloudinary originals replace the development-only
  onboarding upload path in production. Object keys and database authorization
  remain salon/site/revision scoped. Only the existing approved public identity
  projection publishes logo/profile media.
- Phone photos are normalized before upload with the existing image pipeline.
  Multipart requests stay below Vercel's function payload limit. Safari uses a
  supported JPEG fallback for JPEG photos; transparent images retain alpha.
- Replayed media claims return the current revision's authorized URL.
- Transient storage failures preserve ready uploads and their references; only
  confirmed missing objects trigger reupload recovery.
- Both server image decoders apply the image library maintainer's loader-block
  mitigation before inspecting untrusted bytes, including forged MIME types.
- Deployment packaging includes the shared onboarding runtime while excluding
  standalone prototype tooling and tests.
- Required repository lint fixes preserve approved controls and content. JSX
  word spacing, stable defaults, and keyboard-selection behavior are covered by
  the rerun prototype suite.
- Clerk is refreshed within its existing major version for published security
  fixes. Next.js 15.5.25 and React 19.2.8 provide the required framework patch,
  with request-boundary and dependency compatibility updates. See
  [security review](QUICK_BOOK_RELEASE_SECURITY.md).
- The real-auth acceptance harness now refuses non-local targets, imports only
  Development Clerk credentials, uses an isolated database/media directory,
  and records only identities created by that exact test run for explicitly
  approved cleanup. Without cleanup confirmation, those test identities remain.

## Completed checks at the pre-framework-upgrade checkpoint

- Shared prototype: **112 files, 1,258 tests passed**.
- Root and prototype TypeScript checks passed.
- The final Next production build passed on commit `4727735`'s product source
  and the refreshed lockfile, using only isolated CI placeholders and no real
  database credentials.
- The final source/client secret scan passed for **2,279 tracked files and 200
  generated client assets**. All **35 secret-scanner self-tests** passed.
- Final media/integration/service-image check: **35 files, 269 tests passed**
  (233 onboarding integration, 35 existing service-image, one decoder guard).
- Existing image normalization: **29 tests passed**.
- Tenant hard-delete regression: **9 tests passed**.
- Real browser image preparation: Chromium **9.9 MB to 3.3 MB**, WebKit
  **14.4 MB to 2.6 MB**, with multipart payloads below the configured limit.
- The complete PR changed-source lint selection passed: **565 files, zero
  errors**, with 576 non-blocking warnings. `git diff --check` passed.

## Deployment gates still required

1. Finish the remaining hosted/runtime verification of the Next.js 15.5.25
   security upgrade. Its production build, type check, and client scan now pass;
   production activation still depends on the remaining account and CI gates.
2. Finish the current-commit Development Clerk save/reopen acceptance.
   Signup, verification, organization creation, and early/final same-site
   claims now succeed. Dashboard, fresh login, and public booking still need
   their complete runtime evidence; successful signup alone does not prove
   the rest of that journey.
3. Pass all required CI and Preview checks, and use
   the protected-main delivery path. Do not deploy a dirty checkout.
4. Verify the production database target and recovery point, rehearse and run
   guarded migration `0074_onboarding_account_site_foundation`, then activate
   `LUSTER_ONBOARDING_V1_INTEGRATION_ENABLED` for the verified release.
5. Confirm the deployed Git SHA, homepage entry, account save, persistent media,
   dashboard parity, public-site privacy, and booking start after release.

### Framework and real-account verification progress

- Root TypeScript, including Next.js 15 generated route signatures, passed.
- The updated Next.js production build passed, including 142 static pages,
  using isolated CI placeholders and no external database credentials. Its
  client/tree secret scan passed: **2,284 tracked files, 425 generated files**.
- The consolidated updated onboarding suite passed: **112 files, 1,278 tests**
  with default timeouts and one worker. The final image-renderer compatibility
  check passed another 32 tests. The oversized booking test was split into
  independent cases without dropping assertions or increasing timeouts.
- The full root run completed with 6,702 passing tests and six failing tests.
  All six affected suites plus AccountGate subsequently passed together:
  **7 files, 135 tests**, with unchanged timeouts and external-database gates.
- Actual Development Clerk signup, first-organization creation, email-code
  verification, authenticated draft claim, photo upload, and media verification
  passed in the same browser journey. The owner reached saved-progress feedback
  and continued through later setup to the final preview.
- That local file-backed PGlite process then aborted during route compilation.
  Final claim, dashboard persistence, fresh login, and public booking start
  remain unproven by that run. Acceptance is moving to an isolated loopback
  PostgreSQL process; this does not change the application's production data
  path or use production credentials for tests.
- The real signup check identified and fixed the pending-session organization
  handoff. Draft claims still require verified, tenant-scoped identity.
- Server-rejected email verification now pauses automatic claim retries until
  explicit verification succeeds, preserving the same draft and idempotency
  payload. Focused tests cover stale client state and a failed profile reload.
- Read-only production Clerk configuration permits public email/password
  signup and email-code verification. Google and Apple are not enabled and
  remain hidden. No production auth configuration or account was changed.
- The first cloud Preview attempt safely rejected its pre-existing mismatched
  Clerk key modes. A known Development pair is now scoped only to the dedicated
  `codex/quick-book-release-preview` branch; production auth is untouched.
- The dedicated Git-source Preview exposed a second pre-existing test/live
  mismatch in Stripe configuration. Known Development/test credentials and
  explicit Preview environment markers are scoped only to that verification
  branch. Production payment keys, endpoints, accounts, and charges are untouched.
  This is a free-plan application check, not paid-checkout verification.
- At `f83efff`, both CI production builds and the full Vitest suite passed,
  along with all PostgreSQL compatibility/concurrency jobs. The combined CI
  journey exposed a test timing race around a disabled/loading calendar date;
  the required combined check must pass before merging.

Production recovery preparation created the Neon snapshot
`quick-book-pre-0074-20260903T231014Z` on the verified production branch. Snapshot
completion was verified through the authenticated Neon CLI: snapshot
`snap-steep-pine-a4rh3da0`, source `br-lucky-shape-a4fizifo`, 44,457,984 bytes.

### Database release rehearsal (September 4, UTC)

- Read-only production preflight confirmed immutable migration `0073` and its
  exact repository hash. No onboarding tables existed yet.
- Created an isolated child branch, `br-late-union-a4ds4k9u`, from that verified
  production branch. It expires September 5 at 02:00 UTC and is not connected to
  any application, email, billing, or scheduled job.
- Ran the guarded database command against the isolated branch with direct TLS
  credentials held only in the process environment. Lock/statement timeouts
  bounded the operation. Migration `0074` and its repository hash verified;
  all four onboarding tables, both source-ID columns, and nullable owner phone
  were present afterward.
- Server-side fingerprints of existing salon, owner, service, add-on,
  appointment, and payment rows were unchanged. Neither row values nor
  connection credentials were emitted by the rehearsal.
- The separate Vercel Preview project, `lingering-credit-02870328`, had a
  verified `preview` marker and migration `0064`. Created recovery snapshot
  `snap-cold-star-aummg63x`, then used `migrate:preview` with an exact-host
  allowlist to apply its repository chain through `0074` successfully.

Production itself remains on `0073` until the reviewed application release is
ready. No production migration, feature activation, or application deployment
is established by this checkpoint.

## Explicit launch scope

The current plan picker saves plan intent and does not charge customers or
create a paid subscription. It is suitable only for the honestly described
free/beta behavior. Google Places autocomplete still needs a configured,
restricted project key; manual address entry and shared privacy resolution
remain supported. No existing production customer data is used as a disposable
test fixture, and no real charge is part of acceptance.
