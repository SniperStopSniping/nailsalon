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
  and cleans up only identities created by that exact test run.

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

1. Finish production-build and runtime verification of the Next.js 15.5.25
   security upgrade. The patch and compatibility changes are implemented;
   passing checks from the earlier 14.x checkpoint are not a substitute for
   verification on the new framework.
2. Finish the current-commit Development Clerk signup/save/reopen acceptance.
   The official testing helper was updated, but the final run still stopped at
   the development CAPTCHA before creating a user. See the exact
   [acceptance result](../live-acceptance/RESULTS-2026-09-03.md); this does not
   prove production signup is broken or establish downstream account parity.
3. Pass all required CI and Preview checks, and use
   the protected-main delivery path. Do not deploy a dirty checkout.
4. Verify the production database target and recovery point, rehearse and run
   guarded migration `0074_onboarding_account_site_foundation`, then activate
   `LUSTER_ONBOARDING_V1_INTEGRATION_ENABLED` for the verified release.
5. Confirm the deployed Git SHA, homepage entry, account save, persistent media,
   dashboard parity, public-site privacy, and booking start after release.

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
