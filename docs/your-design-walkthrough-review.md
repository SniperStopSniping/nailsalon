# Your Design starting-card walkthrough

## Interactive review update

The passive illustration below is superseded by a hands-on, browser-local demo.
Try with example image → Make something clickable → Instagram → tap the printed
handle → tap the resulting button as a customer. Each action updates a short hint.
The last step simulates opening Instagram; no real website opens. Try again and
reload reset only the ephemeral demo, not the saved onboarding draft.

The Your Design selection button and demo are separate siblings, avoiding nested
buttons and accidental onboarding advancement. Controls are at least 44px high;
keyboard focus follows the next action, hints are announced, and there is no
motion dependency. This is a teaching example, not a replacement uploader or
hotspot editor. Actual uploads, area adjustment, booking and saved drafts are unchanged.

Verified the full sequence on a 390px mobile viewport and replay/placement on a
1440px desktop viewport with the in-app browser. Captures are in
`/tmp/luster-interactive-demo/mobile.png` and `desktop.png`. The 20 focused chooser
and starting-screen tests passed; the 20 unrelated booking tests were filtered
out, not claimed as passing. The Playwright regression was updated; its standalone
runner and the full real-upload journey were not rerun for this demo-only change.

## Previous passive candidate (historical)

Local review only. No push, merge, deployment, or salon-data mutation.

## Focused change

- Your Design incorrectly inherited the full-website page-switch preview. Its different scene count could leave that preview blank.
- The existing starter card now uses a bounded illustrative walkthrough: upload an image, make something clickable, clients tap to connect. The sample Instagram rectangle gains a raised outline; the native booking concept stays underneath.
- All steps stay readable without animation. The demonstration contains no nested interactive controls, no actual social destination, no owner artwork, and no pricing. Screen-reader copy describes the same flow.
- Existing upload/editor controls now say “Make something clickable”, “Edit clickable areas”, and “Add another clickable area”. No uploader, renderer, geometry, booking, or persistence behavior changed.
- No Canva/AI integration was added. This still means uploading an exported image.

## Review evidence

- Phone address: http://192.168.2.10:4189/ (same Wi-Fi, host awake).
- Actual in-app browser screenshots: `/tmp/luster-walkthrough-review/mobile.png` (390×844), `/tmp/luster-walkthrough-review/desktop.png` (1440×1000).
- Desktop reload retained the walkthrough. No runtime error logs or Vite error overlay were observed; no horizontal desktop overflow. Phone card, captions, example rectangle, and booking button were visually inspected. Temporary viewport override reset.
- Chrome control timed out and disconnected; verification recovered using the in-app browser. Existing Chrome artwork draft was not edited.

## Checks and limitations

- Prototype typecheck passed. Root `npm run check-types` passed with repository CI synthetic provider placeholders (process-scoped, no environment files changed).
- StarterChooser: 11 tests passed after updating expectations for the illustrative preview.
- Custom Design and Extras: 288 tests passed in the broader run, including safe uploads, areas, replacement, and owner editing.
- BookingScreens initially passed all 28 tests. Subsequent broader and isolated runs under heavy machine load had timing-sensitive failures in service-dialog/celebration tests (isolated rerun: 23 passed, 5 failed). No booking implementation or BookingScreens test was changed. Do not treat the broad run as green.
- Root lint passed with existing warnings; explicit changed-file ESLint passed with warnings and no errors. `git diff --check` passed.
- Added a focused Playwright walkthrough-to-upload journey and updated renamed controls in the existing Custom Design journey. Standalone Playwright was not run. Full repository suite and a fresh full image-upload/link/save journey were not rerun for this copy/illustration change.
- Node 22 runtime used; Node 20 matrix not rerun.

Visual approval remains with the owner.
