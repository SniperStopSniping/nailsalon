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
