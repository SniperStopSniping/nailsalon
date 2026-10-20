# Canva follow-up preservation

AI link edits now use additions/updates plus explicit link removals. An omitted link remains saved. Page identities, anchors, width/background/spacing, separate native buttons, manual origin, visibility and known artwork text remain outside the model's replacement authority. The original ten-page/80-area draft limits are shared; the previous six-page/40-area model limits no longer truncate supported manual work. New revisions still require artwork review and exact publication approval.

The follow-up reads the saved pages rather than replacing them from an older design brief. Resuming a completed result uses the same prior source and retained provider output. A failed validation during recovery cannot invoke another paid repair; it leaves the saved draft intact and asks for a new attempt. Initial generation still allows one metered repair under the existing spending guard.

## Deterministic verification

- 196 focused tests passed across `drafts.integration.test.ts`, `canva.test.ts`, `canva-generation.test.ts` and `onboarding-canva.integration.test.ts`.
- The two new full-domain cases were rerun after the final replay-failure assertion: 2 passed, 159 unrelated cases intentionally filtered out. These overlap the 196 and are not added to that total.
- The manual fixture has ten repeated-image pages, 50 links including a manual anchor, a separate native booking button, per-page layout, visibility settings and source history. Updating one link retains the other 49, preserves metadata and business settings, clears artwork approval and does not publish.
- A completed result interrupted before source storage resumes once without another provider call. A malformed retained removal is rejected without calling the provider or changing the saved draft. The previous immutable source remains unchanged.
- Unit cases cover the full 80-area bound, duplicate/unknown removals, collisions, changed-target-only padding, forbidden publication fields and retention of previously scanned facts without truncating privacy checks.
- Scoped TypeScript, ESLint and diff checks passed. The first TypeScript run exhausted its 1 GB local heap; the same scoped check passed at 3 GB. No repository timeout or compiler gate was weakened.

These checks use synthetic fixtures, a deterministic provider double and isolated in-memory PGlite. They are not new real-provider generation evidence. [Subsequent hosted runtime, frame recovery and original booking observations](hosted-canva-edit-retention-checkpoint/README.md) are attributed separately. No package, environment variable, database schema, pricing or SMS rule changed.

The earlier [hosted manual layout and original booking checkpoint](hosted-canva-layout-checkpoint/README.md) remains separately attributed. Native About-photo/gallery/review handoff, wider browser/fidelity qualification and final combined release gates remain unfinished.
