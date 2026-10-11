# Onboarding startup loading

Later design screens, full customer previews, final review and the account form load when needed. The onboarding state, asset repository, autosave and browser-history controller stay mounted. No auth, salon, billing, publication or provider logic changes.

The initial starter and business screens remain eager. Shared focus target constants are independent of the deferred review module, avoiding an accidental eager import. A scoped loading/error boundary keeps navigation visible while modules download and offers reload recovery on failure. Heading focus waits for the deferred screen and runs once per navigation.

## Regression coverage

- 35 setup and deferred-content unit cases, including failure recovery, focus/history, draft preservation, preview, account handoff and single plan claim.
- 36 integration cases cover existing account/save/resume boundaries.
- 12 Chromium/WebKit browser cases cover the lifetime offer and startup at 320/390px. Startup tests observe actual requests: design, full preview and account modules are absent from initial navigation. Choosing a starter and reloading preserves progress.
- 17 browser layout/offer cases, including twelve real screens at four viewport widths.
- Production build, explicit typecheck, changed-file lint and secret scan.

## Build comparison

Same dependency graph and build settings, before from the deployed contrast release; the subsequent sign-in border release does not modify onboarding. No manifests or runtime dependencies changed.

- Next first-load estimate: 422 kB to 359 kB (about 15% lower).
- Initial route/layout JavaScript, gzip measured from app-build-manifest: 480,675 bytes to 417,749 bytes (about 13% lower).
- Initial route/layout JavaScript files: 27 to 24.

These are bundle measurements, not field performance or a guarantee of a Lighthouse score. Hosted Preview, CI and live Lighthouse measurements are recorded separately in the release evidence before claiming production success.

## Shared startup fonts and preview readability

Onboarding product chrome reuses the root layout's self-hosted Inter and
Newsreader variables. The standalone review keeps its local font fallbacks.
This avoids requesting a second Inter file under the onboarding asset URL;
customer previews still control their own typography.
The shared section-library stylesheet must not redeclare `Inter` or `Newsreader`
with alternate asset URLs: those declarations shadow the root provider's faces.
The standalone entry and review fixtures import `standalone-fonts.css` instead.

Starter-preview service metadata uses the existing darker muted colour. Browser
coverage checks all miniature price labels, including scenes outside the current
animation frame, and tests both shared and standalone fonts at 320/390/430px in
Chromium and WebKit. Existing startup, reload and lifetime-offer cases remain.
Font request counts and timing must also be verified on a built deployment;
the isolated browser fixture does not represent production bundle performance.
