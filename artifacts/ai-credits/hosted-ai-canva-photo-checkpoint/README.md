# Real owner trial: AI Canva links and separate photos

Source `8ad197118e2120a30fffee856c22015c72dbda86`, isolated Preview `dpl_H3CXn5EixdzWkCi2urMJ7uZX9B2u`. The existing test alias serves this source; the compatible isolated renderer remains unchanged. Production/main, credentials, billing rules and infrastructure were not changed. Local source checks: **300 backend/integration tests in 11 files; 85 UI tests in 5 files; scoped TypeScript, changed-file lint, commitlint, whitespace and tracked secret scan passed.** This is not combined CI/release qualification.

## Actual owner workflow

All uploads, prompts, manual changes, refresh and restoration used the owner-facing application through the browser. No source HTML/CSS was authored, repaired or inserted by a developer for this demonstration. The supplied Dynasty image is original fixed artwork, not a newly generated custom frontend. The model generated its clickable-area configuration; subsequent photo commands created native sections in the same saved draft. Synthetic bordered images test proportions without borrowing another salon's photography.

1. Opened the existing funded synthetic Cobalt account. Started fresh through the normal recoverable control, keeping its live business configuration and published example. Uploaded the user-supplied Dynasty image with **My design or menu → Keep my Canva design**, then confirmed upload rights.
2. Sent: **“Keep this Canva design exactly as uploaded and make its booking and contact links clickable. Keep my saved business settings.”** The composer cleared and showed Working. The configured provider saved revision **83**, with Instagram/email overlays and booking-category/menu actions. Contacts correctly used the saved Cobalt test destinations; the screenshot's printed Dynasty text stayed fixed. An owner must review this mismatch before publication. [First model result](first-model-result.png).
3. Through chat's **My photos** upload, attached a 1200×480 wide image and 480×960 portrait. Sent: **“Add my two new test photos in a Gallery below the artwork, with the wide photo first and the portrait second. Keep the Canva artwork, links, services and settings unchanged.”** One real model call created revision **85**, using validated asset bindings. No additional full-site generation ran. [Desktop Gallery](gallery-desktop.png).
4. Refreshed. The conversation and photo source persisted. Opened **About & Gallery photos** and manually chose **Scrollable gallery**, saving revision **86**. Removed the already-used reference attachment, saving **87**, without removing the saved artwork. This removal was an explicit developer-as-test-owner UI step, not an automatic optimization.
5. Sent: **“Put the portrait photo first and make it the larger first image in the Gallery. Leave the artwork, links, services and settings alone.”** Luna asked an unnecessary clarification about changing the carousel. No requested photo change was applied by that response. Answered **“Yes. Use Large first photo and move the portrait photo first.”** It then saved the correct ordered/editorial Gallery in **88**. [Conversation including the friction](final-chat.png).
6. Used **Restore earlier draft** to restore the pre-trial source at head **89**. Read-only isolation checks verified all existing services, staff and appointments, and every other test business remained unchanged. The exact existing publication **77** and live artifact stayed unchanged. No new appointment or publication was performed in this trial. [Restored draft](earlier-draft-restored.png).

The first and final raw provider results and source snapshots are retained privately; the database also retains their immutable artifacts. [Proof](proof.json) contains identifiers, measured usage and derived checks without raw conversation/source uploads or credentials. All five provider calls completed with ordinal 0: no repair calls or manual source repair occurred.

## Real usage and cost

| Request | Provider/model | Provider time | Estimated USD from measured usage |
| --- | --- | --- | --- |
| Initial conversation | OpenAI `gpt-6.1-sol` | 12.774 s | $0.021089 |
| Canva clickable-area generation | OpenAI `gpt-6.1-sol` | 42.581 s | $0.022509 |
| Add both native photos | OpenAI `gpt-6.1-sol` | 6.108 s | $0.021259 |
| Unnecessary clarification | OpenAI `gpt-6-luna` | 5.410 s | $0.000930 |
| Confirm reorder/large first photo | OpenAI `gpt-6-luna` | 9.555 s | $0.000173 |

Total **US$0.065960 estimated provider usage**. The conservative operator ledger charged **CAD0.131920** using its existing accounting allowance, not a claimed exchange rate. Provider billing/FX/tax were not independently reconciled. These numbers are separate from the customer-facing AI-credit charge. The lower existing operator cap stayed **CAD68.615594**, with **CAD36.027930** used after this trial; the user's CAD80 ceiling was not reset or increased. No purchase, credit grant or subscription change occurred.

## Visual checks and remaining gaps

The displayed desktop photos loaded with their original proportions: 272×108.797 wide and 272×544 portrait in the two-column Gallery. At a 390px viewport, measured sizes were 358×143.195 and 358×716, with no outer horizontal overflow. The [phone artwork screenshot](artwork-mobile.png) shows the actual preserved upload. The source is only 279×1280, and the application correctly warns that it may look blurry when enlarged; this trial does not establish improved sharpness or new visual-design generation.

The in-app browser's phone interactions did not scroll the isolated frame to the Gallery despite successful desktop scrolling and correct responsive DOM measurements. A mobile Gallery screenshot/touch-scrolling journey is **not qualified** here; verify it in another supported browser/device. Do not count a screenshot of the top artwork as Gallery evidence.

Next fixes are explicit: avoid rereading the already-used original Canva image for a photo-only follow-up; map “make the first photo large” directly to the supported owner-labelled layout instead of asking about “editorial”; avoid offering the current Canva page itself as the default saved Gallery photo. New asset-backed photo publication/booking, hosted fault recovery/About replacement, remaining mobile/keyboard/accessibility work and combined release gates still require acceptance. The earlier manual-photo publication/booking evidence is [separate](../hosted-native-photo-checkpoint/README.md). The complete builder is not declared finished; PR #461 remains Draft.
