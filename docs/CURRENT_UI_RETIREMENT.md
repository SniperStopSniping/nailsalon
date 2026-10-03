# Current UI and retirement checks

## Before changing a screen

Fetch origin/main and inspect local changes/commits. Check the production SHA and the actual local server working directory. Identify the current route, role, salon configuration and component callers. Screenshots must identify live Isla versus synthetic environment and existing UI versus proposed design. Historical copy, filename age or styling is not enough to classify code as dead.

## First scoped retirement: post-visit rebooking renderer

Baseline: main `101743755365758e4c265b7104904f3ab730c0df`, confirmed live/healthy on 3 October 2026 at 23:24:55 UTC. Clean dedicated branch/worktree created from that latest origin/main; original checkout and earlier audit evidence preserved.

Commit c3515922 on 23 September deliberately removed appointments/RebookingPrompt from ManageAppointmentView and introduced the confirmation-page next-booking flow. At this baseline, the retired component's only consumers are its unit tests, a stale page-test mock and the standalone nextVisitOffer browser harness. It has no current application import/render path.

This change removes the retired renderer and obsolete tests/harness route. The retained owner prompt test is renamed rebooking-settings.spec.ts to describe its current purpose. Current management tests assert the active offer boundary without mocking a removed component.

## Active behavior retained and checked

- BookConfirmClient → ConfirmationRebookingCard: current configured post-confirmation next-booking UI, using the public booking theme.
- MarketingModal → RebookingPromptSettings: current owner controls.
- ManageAppointmentView → NextVisitOfferRebook: conditional offer after a completed visit.
- Existing private rebook and next-booking API routes, data/settings, migrations and capability handling are retained. A dead renderer does not establish that existing private links or API clients are safe to retire.
- Active owner WalkInModal remains reachable through Today → QuickActionsWidget → admin quick-action handler → AdminModalHost. Its older styling is not dead-code evidence; structural replacement still requires a reviewed proposal.

## Validation

- 186 focused tests across the current confirmation form, confirmation card, management page, offer and owner settings pass.
- 12 component-browser cases pass: current confirmation handoff, 320px/doubled-text/keyboard use across desktop Chromium/mobile Chromium/WebKit; current offer and owner settings across both mobile engines.
- Scoped ESLint has zero errors; 16 existing conditional-test warnings remain in the larger confirmation suite.
- Full type check and production build passed. Secret scanning and diff whitespace checks passed. CI, preview and release evidence are recorded in the pull request as they complete.

These component fixtures are UI regression tests with synthetic responses. They are not proof of real provider delivery or a live Isla end-to-end booking. Separate isolated real-handler/PostgreSQL journey evidence is retained with the audit.
