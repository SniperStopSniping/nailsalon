# Onboarding autosave after preview navigation — F14

## Reproduced defect

Hosted CI 37748400346 at 352c7042 stopped on the mobile WebKit layout-preview
case: double Continue after preview/history navigation reached Policies but
Autosave stayed at Saving. The production onboarding integration imports this
same onboarding state hook from the integration lab.

Two deterministic hook regressions reproduce the underlying issue without
network, timers racing against a wall-clock timeout, or a real account. React
can batch a synchronous save (or reset) with a new edit before effects run.
The old blanket `skipNextSaveRef` then skips the new, unsaved state. No save
timer remains and storage retains the preceding snapshot.

## Correction

Remember the exact state object already handled by save/reset. Suppress the
effect only for that object; a newer edited state uses the existing debounce
and persistence path. Preserve storage shape, retry/error handling, lifecycle
flush, selected layouts and navigation. No auth, account-save API, entitlement,
database, provider or visual change.

## Evidence

- Both save/edit and reset/edit regressions fail before the fix and pass after.
- Remount restores the latest edit; an already persisted snapshot does not
  cause repeated saves.
- 58 focused hook/storage/starter-switch tests pass.
- The original browser scenario passed four repeats in each of desktop
  Chromium, iPhone WebKit and 320px WebKit (12 total). Existing timeouts and
  Saved assertions were not relaxed.
- The browser scenario also checks the restored Policies screen and Saved
  status after reload, retaining a screenshot in its test output.

Full-suite/build/hosted results and release state are recorded separately in
the dated onboarding-autosave-race evidence folder. Synthetic browser storage
does not prove a new owner's authenticated account-save and return journey.
No migration or configuration change is required.

## Hosted test selection

CI37753402021 passed the actual onboarding suite and its layout-preview stage,
but the application job selected the changed prototype test for root Vitest,
whose configuration only owns src/ and scripts/ tests. It failed with No test
files found. The changed-test selector now matches root Vitest ownership;
the required component job still runs the complete onboarding package suite.
Node test regressions cover root/sibling/mixed/prototype selections and assert
that the package suite and selector regressions remain in required CI.

## Browser measurement precision

CI37755496364 then passed the application job and onboarding stages but stopped
on an existing account leave-guard geometry assertion at 430px Chromium:
43.99998474121094 was compared directly to 44. The buttons already have a 44px
CSS minimum. Owner-secondary button assertions now independently require the
existing CSS minimum and the rendered height at 0.001px precision. The 44px and
48px requirements, functional checks and retry count are unchanged. This also
addresses the same previously recorded 47.99993896484375 payment-button case.
No application styles or behavior changed for this correction.
