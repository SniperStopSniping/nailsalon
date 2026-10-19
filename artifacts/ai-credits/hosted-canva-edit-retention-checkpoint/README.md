# Hosted Canva preservation checkpoint

The isolated app Preview serves source `57446ad2605534947496cda670a9d5be6c063003` at [the test link](https://luster-ai-builder-test.vercel.app). Deployment `dpl_5htScVe2h4RxG2iX3YT8xA1V936w` passed exact project/branch/SHA/Preview checks, committed TypeScript and its 164-page build. DB, Redis and Clerk checks passed; unrelated outbound/payment integrations remain disabled. No environment values or schema changed. The renderer was not redeployed.

## Observed browser behavior

The owner reopened the saved manual draft 16 after the app update, with its restored artwork and existing business details. Private preview booking still returned “Booking is disabled in this private preview.” Published revision 14 stayed unchanged.

A signed-out desktop Chrome load naturally stalled at an about:blank child frame and displayed “The website is taking longer to load.” No warning/error entries were returned by the browser console observation. Clicking the ordinary Reload website control recovered the approved artwork, separate button, contacts and canonical menu. The cause of the initial stall was not established. This is an observed recovery, not controlled fault injection. Both [the initial failure](initial-stall.jpg) and [recovered desktop](recovered-desktop.jpg) are retained.

After recovery, clicking the image’s Book Gel Manicure area opened the original Luster menu with the exact canonical service selected at CAD 65 / 60 minutes. Continue opened the original time screen with Taylor Test, 2-hour notice and a 10-minute buffer. Selecting October 21 showed 19 available times; 1 PM and 2 PM remained unavailable around the existing appointment, and 2:15 PM remained available. No appointment was submitted. [Original availability screenshot](original-availability.jpg).

The approved image measured 1120 × 622.22 on desktop and 390 × 216.66 on a fresh 390 px phone viewport, retaining its 900 × 500 original pixels and beige background. The phone document width was 390 px. [Phone screenshot](public-phone.jpg). Phone layout used owner-authenticated IAB on the public route; independent signed-out booking used desktop Chrome. Physical phone touch scrolling is not qualified here.

## AI and data boundaries

This is an owned, hand-authored manual upload fixture. No new model-generated frontend or real-provider follow-up is claimed. Opening AI editing reached this synthetic salon’s zero customer-credit balance; no prompt was sent, purchase made or credit granted. The provider ledger remained at 170 total calls. The new incremental AI contract is covered by [196 deterministic tests and explicit recovery cases](../canva-edit-retention.md); a funded real-provider regression remains.

Read-only verification preserved the private draft 16, exact published revision 14, two publication receipts, the single existing appointment, canonical catalog/staff data and all other 18 isolated businesses. [Sanitized proof](proof.json). No Production action occurred.

Native About-photo/gallery/review handoff, wider fidelity/settings/accessibility/browser qualification and final combined CI/Preview/security/payment gates remain unfinished. PR #461 remains draft and conflicting; these observations do not qualify a Production release or completion of the whole builder.
