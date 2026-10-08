# S115 / F15 — platform policy accessibility

Prepared from clean main `7eb2045d` in a separate worktree. This closes the
specific control-labelling issue recorded in the master audit after release.

## Change

- All five visible labels now target their actual selects with per-instance
  React IDs, including the AI-caption control.
- The icon-only Back action is named "Back to platform dashboard" and has a
  minimum 44px target and visible keyboard focus.
- Defaults, select values, override summary, save payload, error handling and
  locale-specific navigation remain unchanged. No platform policy was saved.

## Verification

- Six unit cases pass: all five labels/defaults; unique IDs across two forms;
  unchanged five-field save payload; failed-save draft retention; English and
  French Back destinations without network writes.
- Twelve actual-component Chromium/WebKit cases pass at 320/390/1280px:
  clicking each visible label focuses its control, Back is named/44px and
  preserves locale, and simulated save refusal retains the selection.
- Isolated fixture uses synthetic defaults, rejects external requests, and
  responds to every API operation with a simulated refusal.
- Actual accessibility tree exposes all five control names and Back. The
  S115-labelled-controls-mobile screenshot and logs are retained in the dated
  platform-policy-accessibility evidence folder. Missing Meta configuration
  in this fixture is synthetic, not a production/provider finding.

This follow-up remains local pending earlier forms/settings delivery, fresh-main
integration, hosted CI/Preview and protected-main release. Physical screen-reader
acceptance is still separate from automated labels and focus checks.
