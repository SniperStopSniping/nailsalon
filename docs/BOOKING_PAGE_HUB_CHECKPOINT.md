# Booking Page hub checkpoint

Branch: `codex/booking-page-hub`. Base: protected main `044e8c3`.
Worktree: `/Users/me/nailsalon-worktrees/booking-page-hub`.

## Working first stage

- Authenticated `/admin/website?salon=…` hub, with tenant authorization before setup lookup.
- Explicit publication/draft status, canonical draft Preview, live link/copy, publish destination.
- Six focused destinations; independent existing site/menu/style/palette fields, no service mutations.
- Shared Services/Portfolio links; separate customer policy and operational settings destinations.
- More puts Booking Page first, reliable icon colour fallback, Time-off requests naming.
- Settings adds a Website layout & colours shortcut, and saved-preview management returns to the hub. The legacy Branding entry stays available because it also owns booking-message controls; removing it caused CI regressions and was corrected.
- Existing long editor stays available for compatibility; focused links remove its large static preview and unrelated controls.
- Existing draft-only guided setup restrictions remain enforced. Published snapshots must NOT simply be unlocked.

## Remaining before calling the entire approved plan complete

- Your Information now groups existing visibility into identity/location/contact/hours accordions plus other public content. Complete current-value editing and upload controls still need connecting; existing settings destinations remain available.
- Published sites now have a guided sequence through the focused current-data editors, not the historic onboarding snapshot. Navigation waits for field saves and stays put on failure. The old onboarding snapshot remains draft-only; complete business-value editing is still pending.
- Existing policy editor is linked; full structured onboarding policy editing needs parity verification.
- Add translated copy for new hub/editor labels, richer owner-data selector previews, and complete mobile browser/save/publish regression coverage. `tests/e2e/booking-page-hub.e2e.ts` now covers authenticated hub → appearance → hub → contact at four widths; it has not yet run in the disposable full-app environment.
- Run repository gates, verify immutable hosted Preview, and only then consider protected-main release. Do not present this checkpoint as production deployed.

## Checks

- Focused hub/navigation/visibility/appearance run: **8 files, 88 tests passed**. Changed-source `npm run test`: **8 files, 87 tests passed** (overlapping coverage; do not add the totals).
- `npm run check-types` passed using the repository-approved CI provider placeholders and explicit test runtime; no real credentials or database were used.
- `npm run lint`: zero errors, three existing fast-refresh warnings.
- Initial CI `33937019795` passed both builds but failed ten Settings index cases because the Branding entry had been redirected. Restored the existing entry and added a separate website shortcut. **All 28 Settings index tests now pass**, plus the visibility/route checks (35 tests in that rerun). Final CI rerun required.
- The new four-size authenticated hub E2E is included in the existing Chromium/mobile-WebKit CI command, not left as an unexecuted orphan test. Await the next CI run before claiming mobile success.
- No production changes, credentials, migrations, charges, or customer fixtures.
- Temporary headed UI harness under `/tmp/luster-booking-hub-ui.yTebiu` did not pass: it omitted the app Tailwind theme configuration (`border-border` unavailable). It was stopped; do not count this as mobile verification or change production styling to accommodate the harness. Use the real isolated Next app for the next browser check.
- Draft PR: https://github.com/SniperStopSniping/nailsalon/pull/159. Initial checkpoint `5541b0a` pushed. Leave the PR in draft until the remaining scope and real-browser checks are complete.

## Continued delivery

- CI 33937700419: full Vitest passed. E2E never started because adding a test to package.json violated the frozen dependency manifest pair. Restored the manifest exactly and added the test to the workflow's existing argument list instead; no gate or dependency protection was relaxed. An unrelated lifecycle PostgreSQL test timed out at 5 seconds; rerun required.
- Guided current-data review and safe save-before-navigation: **54 tests passed** in the page/hub pair, including failure retention. Focused source lint passed.
- Vercel CI/CD skill applied to the workflow change. Production release still requires all CI, mobile and immutable Preview gates.

The user requested checkpoints because account usage is low. Preserve this branch and the original dirty workspace; do not consume reset credits without explicit authorization.
