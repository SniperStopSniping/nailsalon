# Manual Canva layout acceptance

Source tested: `4c187a226085ce116e357c1542476b8f1d44e3a7`, isolated Vercel Preview `dpl_6vP5dLghgT6sPhwhTu6wytvyULNG`. This is an owned, hand-authored manual upload fixture, not new model-generation evidence. No generated site was hand-repaired or substituted for AI output in this checkpoint. No new paid AI calls ran.

## Observed owner journey

1. Opened the existing manual draft 12 through ordinary Development authentication. Its prior published website remained revision 6.
2. Used Images & layout → Adjust image layout to select a wide image, beige background and 16 px spacing. The native colour control committed the colour after setting its value and leaving the control; an earlier generic fill did not commit it. Saved draft 13 through the owner UI. Image bytes, links, page metadata and business settings remained unchanged.
3. Refreshed and opened the saved authenticated preview. The image rendered 1120 × 622.22 at a 1280 px desktop viewport and 390 × 216.66 at 390 px, without stretching or horizontal overflow. Background and spacing matched. Tapping the preview booking area kept booking disabled. The ordinary public page still showed the previous 600 × 1400 artwork before approval.
4. Checked the artwork, reviewed the website-only change, then used Approve and publish. The exact revision 14 approval/publication and completed media finalization are persisted. The test salon now has two total publication receipts, one for 6 and one for 14, without duplicated services or uploads.
5. In a separate signed-out Chrome browser, clicked the published image's Book Gel Manicure area. It selected the existing canonical service for CAD 65 / 60 minutes with Taylor Test. The original booking engine showed 120 minutes' notice, a 10 minute buffer and 19 available times on Oct 21. 1 PM and 2 PM were unavailable around the preserved synthetic appointment; 2:15 PM remained available. No additional appointment was submitted during this checkpoint.
6. Reopened editing, restored the earlier revision 9 design into new private draft 16, and observed the accurate restoration notice. Published revision 14 remained unchanged. The public phone route still showed its beige layout and enabled 225 × 56 px booking target while the restored draft stayed private.

## Evidence

- [Published phone viewport](published-phone.jpg) and [desktop page](published-desktop.jpg).
- [Exact review](exact-review.jpg), [original booking availability](original-booking-availability.jpg), and [restoration notice](restore-notice.jpg).
- [Sanitized publication, isolation and booking observations](proof.json).

Phone layout was measured in IAB on the public route with an authenticated owner browser. The signed-out customer journey was independently observed in desktop Chrome at 1200 px. Chrome's raw-CDP hook remained unavailable during an inspection pause, so this checkpoint does not claim a Chrome-phone pass. The first full phone capture included an unused desktop canvas; the retained screenshot clips the actual measured 390 × 844 viewport. Source and design data were unchanged by capture correction.

The lower Gel-X card also rendered within the 796 px frame after browser-assisted scrolling (document scrollTop 1666, heading top 534 px). Coordinate wheel input did not move that emulated IAB frame, so this observation does not qualify physical phone touch scrolling. The deliberately fixed frame viewport avoids recursive growth of generated 100vh layouts.

## Deterministic checks

- 201 backend/API/compiler/integration tests: `drafts.integration.test.ts`, `custom-sites/route.test.ts`, `canva.test.ts`, and `onboarding-canva.integration.test.ts`.
- 34 interface tests: `CanvaPageLayout`, `CanvaImageQuality`, `CustomDesignStudio`, and `CustomWebsiteFrame`. These include a lost response before commit, recovery after commit only from the exact saved operation, disabled controls, and accurate restore notices.
- Scoped TypeScript, ESLint, commitlint, diff checks and the 5,215-tracked-file secret scan passed. The exact hosted source passed committed TypeScript and its 164-page build, plus project/SHA/DB/Redis/Development-auth runtime checks.

The initial new tests had missing isolated-image environment/ResizeObserver setup and an assertion that incorrectly included the expected bookingPage.draft mirror and updatedAt. Those failed attempts are retained privately; setup and the precise live-projection assertion were corrected. No global CI timeout or security assertion was disabled. Local checks use the release task's qualified installed dependency graph; this does not claim a full local project typecheck against that different graph.

## Limits and remaining work

The existing appointment, six canonical services, staff eligibility and all other 18 isolated businesses remained unchanged. No environment changes, migrations, purchases, messages, Production deployments or live-salon changes occurred. The current app test alias serves the source commit above; the companion evidence commit changes documentation only.

This is not completion of the whole builder. Native About-photo/gallery/review handoff support, wider source-edit/fidelity/settings/accessibility qualification and final combined CI/Preview/security/payment release gates remain. PR #461 still conflicts with main, so no CI result on this source head is claimed; the coordinated release task owns combined qualification. Stale/replay coverage here is deterministic/PGlite; final PostgreSQL process/concurrency release checks remain separate.
