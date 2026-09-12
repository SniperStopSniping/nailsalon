# Your Design: raised artwork links review

Local review candidate, 12 September 2026. No push, merge, deployment, or live salon writes.

## Changes

- Reused Custom Design's existing editor, upload storage, normalized rectangles, action validation, and customer renderer.
- New link flow: choose a destination, place its button on the artwork, drag/resize, Done. New links have generated, editable accessible labels and raised styling by default.
- Transparent button treatment: rounded thin edge, shallow shadow, subtle hover/pressed feedback, and a high-contrast keyboard focus ring. No transforms or enlarged hit regions that would shift the button away from the printed design.
- Four corner controls, full-rectangle dragging, zoom, optional precise resize controls, and a sticky Done footer. Keyboard placement/movement/resizing remain available.
- Existing links retain their original invisible presentation unless the owner enables “Show as a raised button”. This optional field round-trips through existing parsing, compilation, saved preview, and resume paths.
- Booking and its five layouts, native Book appointment, upload safety, location privacy, and image-replacement review rules remain unchanged. Artwork is not imported as authoritative service or booking information.

## Verification

- Prototype typecheck and production build passed (existing large-chunk warning).
- All Custom Design and ExtrasDialogs tests: 288 passed.
- Root compiler, saved-preview, and resume-custom-design tests: 43 passed.
- Direct root `npx tsc --noEmit --pretty false` passed.
- `npm run lint` passed with existing warnings. Explicit ESLint of every changed TS/TSX file passed with warnings and no errors.
- Root `npm run check-types` passed with the repository's approved synthetic CI provider values. Its initial invocation without an explicit runtime environment was correctly rejected by the environment-isolation guard. No real credentials, environment files, or guard code were changed.
- Checks used the available Node 22.23.2 runtime; the Node 20 CI matrix was not rerun locally.
- Browser checks used connected Chrome because agent-browser is not installed. No browser console errors were captured in the reviewed tab.
- Refit the supplied flyer's Instagram, email, and phone rectangles through the UI, enabled raised styling, saved, and reloaded. Checked link-center hit targets and normalized image alignment at 390px mobile and 1440px desktop browser widths.
- Tapped the printed Instagram area and verified the correct profile opened. Verified native Book appointment moves focus to Services & Booking. Email/phone destinations were inspected; no email was sent and no call was placed.
- On the LAN address, independently uploaded the supplied original flyer at phone width, chose Instagram in Add link, tapped the image, resized using corner handles, clicked Done and Save, opened Preview, and reloaded. The image, destination, and raised style returned after image loading.
- Existing Playwright booking-hotspot and responsive-geometry journeys were updated for the new flow. The standalone Playwright runner and full repository suites were not run; this pass used CUA for browser interaction.

## Review

- Phone review: http://192.168.2.10:4189/ (same Wi-Fi, this Mac awake).
- Existing configured desktop draft: http://127.0.0.1:4189/ in the retained Chrome tab.
- Drafts and uploaded bytes are browser/origin-local; a phone does not inherit the desktop browser's draft.
- Actual screenshots: `/tmp/luster-design-buttons-review/mobile.png` and `/tmp/luster-design-buttons-review/desktop.png`.
- Dense printed contact rows remain small on phones. The editor retains the touch-size warning and overlap protection; visual approval should include tapping the owner's actual artwork.
- No OCR, automatic contact discovery, Canva sync, duplicate contact cards, or new rendering/state architecture added.
