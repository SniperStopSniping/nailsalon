# Find my booking accessibility — Q02 / F11 / S133

Reviewed 8 October 2026 from current protected main ab3aee24 in its own clean task worktree.

## Change

The existing form connects its alternative-contact guidance to both inputs. Empty submission now exposes an alert, marks the shared requirement invalid and focuses Booking email. Either nonempty contact clears only the obsolete empty-contact warning; whitespace does not. Failed-request alerts remain while editing, until explicit retry. The existing neutral accepted message has a status role. IDs remain unique for multiple form instances.

API, email precedence, native email validation, publication and phone-privacy gates, token classification, contact lookup and provider behavior are unchanged. No additional recovery step or visual system was added.

## Evidence

- Unchanged-component baseline with new assertions:7 expected failures, 7 passed.
- Component/page/manage/recovery API regressions:83 passed across 6 files; token classification:4 passed. Total 87.
- Existing customer-assistant/recovery browser suite:56 passed, including 10 new cases in Chromium/WebKit. Coverage includes 320px at 200% text, 390px and 1280px wide viewports, Enter-to-submit/focus, field descriptions, native invalid email, server failure/edit/retry and neutral acceptance.
- Direct scoped lint:0 errors, 0 warnings after formatting corrections.
- Optimized production build passed on retry using approved synthetic CI provider values. Explicit route generation and TypeScript also passed.

Actual local browser screenshots show the real component inside the repository's existing isolated page fixture. Empty submission focused Booking email and made both descriptions reference the error; a synthetic phone value cleared only that warning. No API request or customer message was sent during the manual walkthrough. Both widths have matching document/viewport widths. The fixture wrapper is not a full production route capture.

![S133 — empty-contact validation at 390px](mobile-390-validation.jpg)

![S133 — obsolete warning cleared at 320px](mobile-320-corrected.jpg)

## Limits and retained failed attempts

The tests restrict provider transport to loopback fixtures. Accessibility role/description/focus assertions do not prove physical screen-reader output. Controlled recovery delivery and physical phone acceptance remain B03/B05. Hosted Preview, CI and production release are pending.

The initial local build failed with ENOSPC. Only three regenerable compiler caches from this and two completed goal worktrees were removed, recovering about 4 GB. Source, dependencies, logs and historical evidence were preserved. Original failed build and retry logs remain in the local review evidence. Full browser tests also regenerated 24 unrelated captures; they were preserved with a SHA256 manifest outside the checkout, and only the five tracked generated images were restored to HEAD. No unrelated image is included in this PR.

The initial dependency-lock comparison failed because of automatic root-version metadata; a normalized comparison confirmed identical dependency graphs before ignored dependency links were created. Initial lint reported 9 formatting errors and 1 conditional-test warning; these were corrected without weakening assertions or retries. A nonexistent extra token test filter selected nothing; the actual 4 token cases were subsequently run by their discovered filename. All counts above refer to selected, completed tests.

No schema migration or provider configuration is required for this correction. Rollback is a normal revert of the scoped change.
