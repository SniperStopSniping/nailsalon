# Quick Book audit checkpoint — 2026-09-04

## Delivery state

- Worktree: `/Users/me/nailsalon-worktrees/quick-book-owner-journey-audit`
- Branch: `codex/quick-book-owner-journey-audit`
- PR: https://github.com/SniperStopSniping/nailsalon/pull/158
- Pushed checkpoints: `7f70ac2` (owner persistence/mobile previews), `13e47eb` (retain recovery until confirmed dashboard arrival).
- Session readiness/cookie compatibility was pushed as `01fba2a`. This follow-up corrects the acceptance runner's OTP-preparation wait; read current HEAD for its commit ID.
- Production is still `f7a2faf`; do not claim these audit fixes are live until the final merge/deployment is verified.
- Original dirty workspace and accepted LAN server on port 4201 were preserved. Never deploy an uncommitted checkout.

## Completed verification

- Real Clerk Development desktop lifecycle: signup, verification, same-site/media save, dashboard, reload, logout, fresh-browser login, local publish, public guest booking start passed.
- Reward preview/footer/outer-page/signup reachability passed at 320×568, 375×667, 390×844 and 430×932.
- Initial committed fix passed all required CI gates, both production builds and 6,807 root unit tests.
- Handoff retention passed 60 affected tests. Cookie compatibility passed 129 focused tests. Dashboard readiness/retry passed 16 tests.
- Hosted Preview `dpl_EgpcHtHXmLHyJQHr8F9JcJXgJ1AB` verified SHA `01fba2a` and mobile Business→Screen 6, with no hosted account creation.
- The normal acceptance journey contains no test-side token refresh that could mask the Safari bug.

## Remaining gates before release

1. Commit/push final changes; run required CI on that exact SHA.
2. Create an immutable Git-source Preview from the same SHA on `codex/quick-book-release-preview`; verify mobile smoke. Existing helper: `/tmp/luster-git-preview.wV7opg/request.json` (update only SHA). Use existing CLI authentication; never create/pull dotenv files into the active worktree.
3. Finish the ordinary headed Chromium mobile lifecycle after fixing the OTP-preparation wait. WebKit's full Development-auth lifecycle is blocked by the development-only cookie issue below. No physical iPhone/VoiceOver success is claimed.
4. Recheck PR review threads, merge only after all required gates and Preview pass, and verify production aliases against the merge SHA.

## Latest verification and compatibility follow-up

The normal headed Chromium 390×844 lifecycle PASSED on `5509771` (3/3, 2.4 minutes), including signup, same-site/media saves, dashboard, logout/fresh login, setup resume, publication and public booking start. Evidence is in `/tmp/luster-live-acceptance-GbRnaZbg/evidence/acceptance-e4373b53-183c-4b06-960e-f7e31a2b5aa5/`.

CI then caught a compatibility regression: two existing mobile-WebKit appointment tests could not open server-authorized legacy/impersonation dashboards while Clerk remained unloaded. This follow-up permits an authoritative successful admin response to render independently of Clerk loading, while failed early requests still wait for loaded Clerk before token refresh/retry. All 18 dashboard unit tests pass, including the exact unloaded-legacy/impersonation states. Do not merge until the affected CI browser tests and all required gates pass on this follow-up SHA. Earlier CI failure: run `33928174207`; artifacts `/tmp/luster-ci-safari.owQmBT`.

## Safari finding and isolated test restart

After successful signup/claim, the immediate cookie-only dashboard request could return 401 until Clerk refreshed its session token. The dashboard now awaits loaded auth and a fresh token; signed-in failures stay on Retry/Sign out instead of redirecting forever. SDK verification and tenant authorization remain mandatory. Both bare and instance-suffixed session cookies establish request context.

The retained diagnostic browser was closed and its memory-only password discarded. Safe observations are in `/tmp/luster-live-acceptance-5vflT2OR/evidence/safari-diagnostic/auth-observations.md`. Test identities are retained; do not delete them without scoped cleanup approval.

The precise remaining WebKit failure is Clerk's `dev-browser-missing`: the request omits `__clerk_db_jwt` despite a valid session JWT. Installed Clerk SDK source confirms this gate applies only to development instances. No production auth workaround was added. This is not a completed Safari lifecycle test.

The subsequent normal Chromium run reached signup but its synthetic known OTP was submitted before `prepare_verification` completed. The runner is being corrected to await preparation, not to change production verification or bypass authentication.

Current isolated final scope (migrated/verified; first test identity already created):

- Runtime: `/tmp/luster-live-acceptance-r9tbYZQA`
- Run: `acceptance-9a48141f-0a7d-47a6-88b8-930813deef0e`
- Isolated DB/role: `luster_acceptance_ee7f13a20816af5c` on `127.0.0.1:55441`
- Server: port 4212, execution session `77043`. The first Chromium run's evidence is under the runtime's `evidence/<run>/pw-output/` directory. Do not reuse its identity for an unrelated signup; use the runner's isolated run scope.
- Start `live-acceptance/run-local.ts server`, then `test`, using Node 20 and the README's guarded variables: the runtime/run above, `LIVE_LOCAL_POSTGRES_CONFIRMED=true`, the matching loopback PostgreSQL URL, `LIVE_LOCAL_PORT=4212`, and `LIVE_DEVELOPMENT_ENV_FILE=/Users/me/Desktop/nail-salon-copy2 copy 2/.env.development`. The test additionally uses `LIVE_HEADED=true` and `LIVE_BROWSER_PROJECT=webkit-live`.
- Stop only our 4212 process before switching scope; preserve 4201/4211. Do not edit source or run type generation during the browser lifecycle.

Post-fix rerun scope is separately prepared (the safety guard requires run-specific DB isolation): runtime `/tmp/luster-live-acceptance-GbRnaZbg`, run `acceptance-e4373b53-183c-4b06-960e-f7e31a2b5aa5`, DB/role `luster_acceptance_f31dde75c65d0e01`. Use the same guarded launcher with `LIVE_BROWSER_PROJECT=chromium-live` and its normal 390×844 mobile profile. No diagnostic token helper is used.

No production customer fixtures, real charges, emails/SMS, migrations, or provider configuration changes are part of this verification.
