# Canonical service order — 2026-10-18

New services now receive distinct canonical `service.sort_order` values in their reviewed draft order, appended after existing finite positions. Existing service positions, manual gaps, prices, staff assignments and appointment snapshots are preserved. Out-of-range positions fail within the existing publication transaction instead of partially saving.

Setup and custom website data now use the original catalog's `sort_order`, then creation time, with a deterministic identity tiebreak. Only the presentation copy is sorted. The raw records retained for row locks and the baseline hash still use their original identity ordering, so a code update does not invalidate older drafts merely by changing the hash's array order. A new manual order change after approval remains a stale-data conflict and cannot be overwritten.

No migration, parallel catalog or service-order model action was added. Older AI test records that never persisted their intended positions cannot have an unrecorded order reconstructed safely; their existing canonical positions/creation times are respected. This fixes new setup/publication order and honors the normal manual Services ordering, without guessing a retroactive order or changing a published example.

Verification: 143 draft integration cases and three ordering cases passed, including publish/replay/reopen, preserving a manual position of 41 while appending 42, unchanged raw-row hash semantics, and a newer manual ordering conflict. Thirteen real disposable-PostgreSQL publication/concurrency cases passed. TypeScript, scoped lint and whitespace checks passed. One initial test incorrectly submitted internal origin/confirmation metadata; the strict validator rejected it and the sender fixture was corrected. Validation was not loosened.

No production data, migration, push, merge or deployment occurred. A new real owner journey will verify the resulting customer menu separately; these deterministic cases do not claim new AI generation.
