# Booking Page hub checkpoint

Branch: `codex/booking-page-hub`. Base: protected main `044e8c3`.
Worktree: `/Users/me/nailsalon-worktrees/booking-page-hub`.

## Working first stage

- Authenticated `/admin/website?salon=…` hub, with tenant authorization before setup lookup.
- Explicit publication/draft status, canonical draft Preview, live link/copy, publish destination.
- Six focused destinations; independent existing site/menu/style/palette fields, no service mutations.
- Shared Services/Portfolio links; separate customer policy and operational settings destinations.
- More puts Booking Page first, reliable icon colour fallback, Time-off requests naming.
- Settings appearance and saved-preview management links return to the hub.
- Existing long editor stays available for compatibility; focused links remove its large static preview and unrelated controls.
- Existing draft-only guided setup restrictions remain enforced. Published snapshots must NOT simply be unlocked.

## Remaining before calling the entire approved plan complete

- Your Information still needs the complete current-value identity/location/contact/hours accordion editors and upload controls; currently exposes existing visibility and settings destinations.
- Guided editing of published sites needs a current-data, revision-safe edit flow; reopening the historic onboarding snapshot is unsafe and intentionally unavailable.
- Existing policy editor is linked; full structured onboarding policy editing needs parity verification.
- Add translated copy for new hub/editor labels, richer owner-data selector previews, and complete mobile browser/save/publish regression coverage.
- Run repository gates, verify immutable hosted Preview, and only then consider protected-main release. Do not present this checkpoint as production deployed.

## Checks

- Initial focused run: 81 tests passed; appearance test subsequently fixed to mock its unused DB import, then 7/7 appearance/app-grid tests passed.
- Initial TypeScript passed; rerun after test additions pending at checkpoint creation.
- Focused source lint: zero errors, one existing AppGrid fast-refresh warning.
- No production changes, credentials, migrations, charges, or customer fixtures.

The user requested checkpoints because account usage is low. Preserve this branch and the original dirty workspace; do not consume reset credits without explicit authorization.
