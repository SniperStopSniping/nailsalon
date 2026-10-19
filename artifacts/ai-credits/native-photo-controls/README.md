# Native photo controls — local checkpoint

Base: `df96af0944bc2113bbfb877b5d9b4a6dcd1f120a`. Adds owner controls on the same draft as the [private-photo foundation](../native-photo-foundation/README.md). This checkpoint is **not deployed** and does not complete native photo uploads or the AI builder.

## Source outcome

The collapsed **About & Gallery photos** panel lets an owner inspect one saved photo at a time, edit its description, remove it, move Gallery photos earlier/later, choose an existing Gallery layout, and add/replace with a ready saved photo of the appropriate role. It preserves image proportions and keeps the Canva artwork fixed. Removed files remain available for an explicit later draft choice; historical source is not modified. Only the opened photo is requested, with cancellation and retry using the bounded authenticated loader.

The `edit_native_photos` action accepts a strict revision, operation, section and bounded change. The server derives ownership from the authenticated actor, requires an owner membership, and verifies exact original site/revision, role and media readiness. Source creation and the shared draft edit occur in one transaction. Canonical services, business settings and public configuration stay unchanged. The ordinary manual draft projection advances; this is expected and is not public publication.

An edit creates a new source, resets the artwork review and uses the existing exact-review/publication boundary. Replays reuse the original operation. Stale saves fail; a failed business-baseline check rolls back the staged source. The studio retains the operation during a request failure and checks the authenticated saved head before claiming a lost response succeeded. No AI credit is charged for these manual controls.

## Verified locally

| Scope | Result |
| --- | --- |
| PGlite onboarding/handoff/native edit integration + owner API | 30 tests / 2 files passed |
| Native editor, actual studio action wiring/recovery, isolated frame and bounded loader UI | 38 tests / 4 files passed |
| Scoped TypeScript including new source and tests | Passed |
| ESLint of changed TypeScript/TSX and diff whitespace | Passed |

Domain cases include move/describe/remove/restore of saved photos, same-operation replay, mismatched-operation rejection, stale revision, cross-salon/wrong-role rejection, owner-role denial, transaction rollback after changed business data, unchanged live booking configuration, no duplicate artwork assets, and zero model calls. UI tests cover exact photo/section selection, descriptions, saved replacement, disabled saves, load retry, closing/cancellation and a committed save with a lost response. Those UI requests use deterministic test fixtures. This is not a real-provider trial, hosted screenshot, physical-device test or complete browser-to-database journey.

Initial failures were test-harness issues: comparing the intentionally updated manual draft projection with the full old salon row, and a missing ResizeObserver test double. The final tests explicitly verify unchanged public/business/booking configuration and the persisted updated owner draft. Failed-run logs were retained privately; authorization and validation were not weakened.

## Still required

- New About/Gallery photo uploads in this panel and isolated hosted storage qualification.
- Chat edits of separate native photos and restoration of missing canonical About text bindings.
- Compatible renderer/app rollout, hosted desktop/mobile/keyboard/save-resume checks, exact publication and original booking acceptance with photos.
- Broader AI-builder fidelity/provider and combined release gates tracked on draft PR #461.

Native enrollment remains off. No configuration write, migration, provider call, purchase, hosted deployment or Production change was made for this checkpoint. The test link remains on source `57446ad2605534947496cda670a9d5be6c063003`. No new screenshots are claimed because these controls have not yet been qualified in the hosted owner workflow.
