# Confirmation readability and polish

The confirmation page keeps the salon's current onboarding palette and fonts.
Supporting copy and labels now use the stronger primary ink, including card
headings in the dark palette. Following owner feedback, the existing rounded
cards, inputs, fonts and shadows are preserved. Keyboard focus remains visible.

The header uses “Back”, reduces vertical padding and removes the large
pre-booking icon. Instant-booking copy is shortened to “Not booked yet. Confirm
below to reserve your time.” Request, reschedule, deposit, policy and consent
copy remains unchanged. The reading toggle keeps its own compact row for text
enlargement. The shared receipt summary retains its cards and text-reflow fix.
Availability and payment logic are unchanged.

## Design evidence

- [Earlier Figma layout study](https://www.figma.com/design/CFsAgvjjShZs0KqnFLwMfw?node-id=4-2): superseded by the owner's preference to preserve the existing cards; not the final implementation or live production.
- [Mobbin / Fresha review and confirm](https://mobbin.com/screens/0ef6b0b2-ed22-4c29-bb2c-74719882f58f): appointment grouping, restrained dividers and clear final action informed this pass.
- [Mobile implementation](mobile.png)
- [Desktop implementation](desktop.png)

Implementation screenshots render the real React confirmation component with
synthetic local data and fallback fonts, without creating an appointment.

## Verification

- Confirmation unit tests: 93 passed.
- Appointment regression: 103 passed.
- Current confirmation/readability browser suite: 52 passed on desktop Chromium
  and mobile WebKit. Earlier broader contrast suite: 102 passed.
- Follow-up coverage checks all eight palettes, field focus and 320/375/1280px
  layouts, including 200% text reflow. A discovered duration-badge overflow was
  fixed rather than suppressing overflow.
- Type checking passed with the repository's approved CI provider placeholders.
- No database, scheduling engine, deposits, holds, consent or policy mutations.

Worktree: `/Users/me/nailsalon-worktrees/confirmation-polish-20260912`

Branch: `codex/confirmation-polish-20260912`

Base: `1790d26cc69ecb8c42f68134d47b74d90ad1d469`

Builder worktree and branch were not modified. Deployment status is reported
separately after release gates; screenshots alone do not establish live status.
