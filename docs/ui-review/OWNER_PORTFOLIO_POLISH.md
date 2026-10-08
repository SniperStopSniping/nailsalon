# Portfolio controls and recovery — S52 / F07

October 8, 2026 Toronto. Separate clean worktree from latest origin/main
7db6e01e. Part of the approved owner dashboard/onboarding visual brief.

## Observed evidence

The active AdminModalHost opens PortfolioModal. The isolated browser fixture
imports that actual component, AppModal, owner styles and fonts; it uses local
service images with synthetic photo records. External requests are blocked and
all writes return a simulated refusal. No live photo was uploaded or deleted.

At 390px, Portfolio already inherited the new owner header/surface. Choose photos
and batch actions retained black fills and smaller controls; a measured tagging
button was 33.5px high with 13px text. A focused pre-change browser case reproduced
a refused DELETE closing the dialog without displaying a failure. Its trace,
error context and failing log are retained as baseline evidence. This is an
isolated reproduction of client behaviour, not a claim of live data loss.

## Changes

- Shared cream cards and plum actions, at least 44px tagging targets and 48px
  photo selection action, readable labels, focused selection and bounded desktop
  content. Keep unavailable families disabled and preserve permission/limit gates.
- Library-load errors have a reachable Retry action. Batch errors remain beside
  their controls and keep the selected photos; interrupted requests are caught.
- Check DELETE response status before treating it as success. Failed/network
  requests keep the confirmation and photo, with an error inside the dialog.
  Successful deletion removes its ID from selection and refreshes the library.
- Preserve upload preparation, tenant routes, API payloads, publication rights,
  Discover eligibility, allowance and server deletion rules. Destructive actions
  retain their red treatment and explicit confirmation.

## Verification

- 12 Portfolio units pass, including existing upload failure coverage and new
  JSON/non-JSON deletion refusal, network error, successful removal and selection.
- 16 actual-component Chromium/WebKit cases pass at 320/390/1280px. They cover
  targets, no overflow, permission/disabled gates, empty/library error recovery,
  batch failures, refused deletion, interrupted requests and Back navigation.
- Explicit source/fixture lint and production types pass. Normal commit hooks
  are required; no checks are disabled.
- S52 screenshots retain before/after mobile, 320px batch error, delete refusal
  and settled desktop views. The initial desktop capture caught the opening
  transition and was replaced by a settled capture. Viewport overrides cleared.

## Delivery

Prepared locally while PR377's required hosted checks run. Integrate the released
settings main before this follow-up's hosted CI/Preview and normal main release.
Retain all browser registrations if adjacent CI steps conflict. This change is
not live yet. Provider, real-owner and physical-device acceptance remain separate.
