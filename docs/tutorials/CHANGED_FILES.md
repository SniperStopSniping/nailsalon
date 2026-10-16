# Exact application and browser-test files changed

All changes are scoped to the tutorial walkthrough findings; no database schema, production migration, booking/payment policy or entitlement was changed.

## Application and regression tests

- `src/app/(unauth)/book/time/BookTimeClient.test.tsx`
- `src/app/(unauth)/book/time/BookTimeClient.tsx`
- `src/app/[locale]/admin/page.test.tsx`
- `src/app/[locale]/admin/page.tsx`
- `src/app/api/salon/services/route.test.ts`
- `src/app/api/salon/services/route.ts`
- `src/components/admin/AdminModalHost.tsx`
- `src/components/admin/ClientsModal.test.tsx`
- `src/components/admin/ClientsModal.tsx`
- `src/components/admin/PortfolioModal.test.tsx`
- `src/components/admin/PortfolioModal.tsx`
- `src/components/admin/ServicesModal.catalogTab.test.tsx`
- `src/components/admin/ServicesModal.test.tsx`
- `src/components/admin/ServicesModal.tsx`
- `src/components/admin/SettingsModal.payments.test.tsx`
- `src/components/admin/SettingsModal.tsx`
- `src/components/admin/staff/StaffDetailPage.test.tsx`
- `src/components/admin/staff/StaffDetailPage.tsx`
- `src/libs/integrationHealth.sms.test.ts`
- `src/libs/integrationHealth.ts`
- `tests/browser/ownerNavigation/main.tsx`
- `tests/browser/ownerNavigation/owner-navigation.spec.ts`

## Reusable production tooling

Source recipes are under `tools/tutorials/`: guarded runtime/fixtures, actual UI capture flows, timestamped screencast, branded compositor, metadata locking, output/source/tap/layout verification, gallery/index builder and review-package builder. Licensed fonts, the graphite-phone template and hand assets are under `docs/tutorials/assets/`.

## Reports and deliverables

`README.md`, `manifest.json`, `index.html`, `inventory.md`, `POSTING_ORDER.md`, `VERIFICATION.md`, `UX_IMPROVEMENTS.md`, `LIBRARY_PROGRESS.md`, and per-video `storyboards/` form the written library. Current MP4s, covers, raw footage and earlier revisions remain local and are excluded from Git. The review ZIP carries every current MP4/cover and the reusable recipes, without private runtime files.
