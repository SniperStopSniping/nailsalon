# Quick Book audit checkpoint — 2026-09-04

## Delivery state

- Worktree: `/Users/me/nailsalon-worktrees/quick-book-owner-journey-audit`
- Branch: `codex/quick-book-owner-journey-audit`
- PR: https://github.com/SniperStopSniping/nailsalon/pull/158
- Pushed checkpoints: `7f70ac2` (owner persistence/mobile previews), `13e47eb` (retain recovery until confirmed dashboard arrival).
- This checkpoint accompanies the final Safari session-readiness/cookie-compatibility fix. Read the current HEAD for its commit ID.
- Production is still `f7a2faf`; do not claim these audit fixes are live until the final merge/deployment is verified.
- Original dirty workspace and accepted LAN server on port 4201 were preserved. Never deploy an uncommitted checkout.

## Completed verification

- Real Clerk Development desktop lifecycle: signup, verification, same-site/media save, dashboard, reload, logout, fresh-browser login, local publish, public guest booking start passed.
- Reward preview/footer/outer-page/signup reachability passed at 320×568, 375×667, 390×844 and 430×932.
- Initial committed fix passed all required CI gates, both production builds and 6,807 root unit tests.
- Handoff retention passed 60 affected tests. Cookie compatibility passed 129 focused tests. Dashboard readiness/retry passed 16 tests.
- Hosted Preview `dpl_7DdXHBKP45mYMWYbZx3fj5gbg9jh` verified SHA `7f70ac2` and mobile Business→Screen 6; it is not verification of the final follow-up.
- The normal acceptance journey contains no test-side token refresh that could mask the Safari bug.

## Remaining gates before release

1. Commit/push final changes; run required CI on that exact SHA.
2. Create an immutable Git-source Preview from the same SHA on `codex/quick-book-release-preview`; verify mobile smoke. Existing helper: `/tmp/luster-git-preview.wV7opg/request.json` (update only SHA). Use existing CLI authentication; never create/pull dotenv files into the active worktree.
3. Finish the ordinary headed WebKit lifecycle without diagnostic helpers. No physical iPhone/VoiceOver success is claimed.
4. Recheck PR review threads, merge only after all required gates and Preview pass, and verify production aliases against the merge SHA.

## Safari finding and isolated test restart

After successful signup/claim, the immediate cookie-only dashboard request could return 401 until Clerk refreshed its session token. The dashboard now awaits loaded auth and a fresh token; signed-in failures stay on Retry/Sign out instead of redirecting forever. SDK verification and tenant authorization remain mandatory. Both bare and instance-suffixed session cookies establish request context.

Current retained diagnostic browser/password are memory-only in agent Node session `92907` (`dy.page`, `dy.browser`). Do not print or persist the password. Existing diagnostic server session `97555` uses port 4212, runtime `/tmp/luster-live-acceptance-5vflT2OR`. Safe observations: `evidence/safari-diagnostic/auth-observations.md` there. Test identities are retained; do not delete them without scoped cleanup approval.

Fresh final scope is already migrated/verified, with no identity created yet:

- Runtime: `/tmp/luster-live-acceptance-r9tbYZQA`
- Run: `acceptance-9a48141f-0a7d-47a6-88b8-930813deef0e`
- Isolated DB/role: `luster_acceptance_ee7f13a20816af5c` on `127.0.0.1:55441`
- Start `live-acceptance/run-local.ts server`, then `test`, using Node 20 and the README's guarded variables: the runtime/run above, `LIVE_LOCAL_POSTGRES_CONFIRMED=true`, the matching loopback PostgreSQL URL, `LIVE_LOCAL_PORT=4212`, and `LIVE_DEVELOPMENT_ENV_FILE=/Users/me/Desktop/nail-salon-copy2 copy 2/.env.development`. The test additionally uses `LIVE_HEADED=true` and `LIVE_BROWSER_PROJECT=webkit-live`.
- Stop only our 4212 process before switching scope; preserve 4201/4211. Do not edit source or run type generation during the browser lifecycle.

No production customer fixtures, real charges, emails/SMS, migrations, or provider configuration changes are part of this verification.
