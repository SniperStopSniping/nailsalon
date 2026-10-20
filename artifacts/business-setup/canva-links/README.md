# Preserve an owner's Canva artwork and add links

The chat attachment dialog now has an explicit **Keep my Canva design** choice for owner-authorized PNG/JPG/WebP exports. Existing editable custom frontend generation remains available. Multi-page exports are stacked in upload order. PDFs remain reference inputs for editable redesign; preserved PDF rendering is not supported in this checkpoint.

The configured vision model identifies percentage-based clickable rectangles, accessible labels and constrained destinations. It cannot write frontend code, approve artwork, publish, change prices or create appointments through this action. One bounded, metered repair is allowed; both outputs remain in the private usage ledger. Completed responses are retained for recovery without another provider call. The trusted compiler displays the existing normalized upload bytes unchanged and adds transparent link areas. Ordinary upload WebP preparation still applies; this does not promise byte-identical source PNG storage.

Booking areas open the original Luster flow. Individual services resolve only through current tenant-scoped service identities. Contact areas use saved, validated Instagram/email/phone values. Explicit external website links require public HTTPS destinations without credentials or custom ports. Owners can move/resize areas with pointer or keyboard, edit destinations and labels, and save a new revision without a model call. Printed artwork is edited in Canva and re-uploaded; it is not falsely presented as editable HTML text.

An owner must check the artwork's fixed text, prices, policies, hours, contacts and address before sharing or publishing. This is separate from exact-revision approval/publication. AI and ordinary source saves cannot confer that acknowledgment. Changes to relevant business facts invalidate it. Public rendering suppresses outdated artwork and falls back to Luster's ordinary live booking page, without serializing the stale image/source. Known hidden addresses extracted from artwork are rejected. As OCR cannot guarantee reading every pixel, the explicit owner privacy/artwork check remains required.

No new database schema, booking engine, provider, payment or messaging integration was introduced. The same draft, immutable source/asset history, owner authorization, approval hash, publication receipt and original scheduling flow are reused. Existing revision restoration and full reset remain available.

## Verification

Disposable PGlite integration tests cover vision-result application, unchanged saved asset hashes, private draft isolation, owner-only artwork acknowledgment, safe sharing, malicious geometry/source rejection, inspiration/tenant rejection, one repair, retry deduplication, hidden addresses, exact publication, canonical service mapping and suppression after price changes. Unit tests cover compiler/bounds/overlap/URLs/fact fingerprints/ambiguous targets. Owner component tests cover the new explicit upload choice. Renderer browser tests cover unchanged rendered pixels, contact links, canonical service areas, preview booking denial and broken-image overlay suppression, alongside existing malicious-code isolation tests, on desktop Chromium, mobile Chromium and mobile WebKit.

## Actual owner-workflow evidence

The input was an original synthetic Canva-style PNG export, prepared as a test fixture. It was not represented as a model-designed artwork. The owner uploaded it through **My design or menu → Keep my Canva design**, confirmed usage rights, and used the ordinary chat. No developer-authored website HTML/CSS or hidden generated-source repair was substituted. AI generated the link positions/actions; the application's trusted compiler preserved the uploaded artwork. Manual accessible-label edits were performed through the shipping owner controls to verify editability.

- First request: “This is my own Canva export. Keep the design unchanged and make the booking buttons, Instagram, email, phone and website clickable. I work solo in Toronto. Use the service and opening hours shown in it.” The model read the business name, Gel manicure at CAD $65/60 minutes, hours and contact details, then generated six links. Draft 62, 21.816 seconds.
- Follow-up: “Make the Instagram clickable area a little taller, while keeping the artwork and every other link unchanged.” Draft 63, 12.589 seconds. Comparing saved area data confirmed only the Instagram geometry changed.
- Follow-up: “Make all the links easier to tap on a phone. Keep the artwork and every destination unchanged.” Draft 66, 13.904 seconds. All six areas measure at least 44px at 360px page width; the390px hosted browser measured 47.656px minimum height. The artwork stayed unchanged.
- Owners edited accessible labels manually, refreshed/resumed in fresh authenticated browser contexts, restored the first design as draft 67 and returned to the later design as draft 68. Restoring used the owner controls and made no model call.
- Exact artwork review and price confirmation preceded approval and publication of **revision 72**. The resulting public entrance used canonical service identities. Separate customer sessions completed the original service, staff, availability, confirmation and appointment-creation flow at **CAD $65/60 minutes**, with HTTP 201 and two durable isolated appointment records. The second booking preserved the earlier appointment details. Publication and booking evidence is summarized in `verification.json`.

The displayed asset has the same SHA256 as the saved reference. A 600×1400 browser screenshot matched the decoded saved image with **zero differing channels**. Upload preparation still re-encodes images as WebP; this is equality to the saved normalized upload, not a claim of lossless original PNG storage. Instagram and website regions opened the expected destinations. Phone/email URI targets were checked without calling or sending anything. Public read-only sharing remains booking-disabled, and unauthenticated owner reads/writes remain 401. All four previously shared custom-generated examples remained accessible with their original names after the new draft/reset.

Testing exposed and fixed small mobile targets, a review refresh race, premature tab clicks during initial loading, and duplicate attachment chips. These were application fixes; generated artwork/source was not secretly repaired. Public projections omit private OCR/model critique. Private previews warn when important booking facts change and display the current proposed booking values separately from the fixed artwork. Booking links cannot be redirected to an unrelated scheduling website through the general website action.

## Usage and deployment

Six real OpenAI calls requesting **gpt-6-luna** completed without a model repair. Their recorded tokens estimate **USD $0.004234**, counted as **CAD $0.008468** by the app's conservative 2 CAD/USD allowance. Total recorded/reserved allowance including the frozen historical local amount is **CAD $40.242008 of $80**. These are configured-rate estimates and allowance tracking, not a reconciled provider invoice. No further paid calls were needed for manual editing, restoration, review, publication or booking.

Application changes are committed on `codex/ai-business-setup` and remain in draft PR #455. The isolated application test link is https://luster-ai-builder-test.vercel.app/ai-website-test. The renderer is https://luster-ai-render-test.vercel.app, Preview deployment `dpl_BMb84vLbnD2ZaEzmBn9AidtT2Thp`; its served boot script was byte-compared with the committed runtime. The final application runtime is `3187765db78d8e435cae0dc5d795784c1c1a0800`, READY Preview deployment `dpl_4V5DEyjLwcajRbmSAjQzmyDNhuy8`. Only the two isolated test aliases were assigned; production aliases were not changed.

The database's exact Preview hostname and marker were checked independently. Runtime boot guards enforce test-mode Clerk/Stripe credentials; billing remains dark. No Twilio, Resend or Calendar credentials apply to this branch. The synthetic booking produced failed email attempts with no provider message IDs and pending email/calendar jobs; those exact test appointment jobs were marked failed after verification to prevent later retries. No messages, payments, production deployments/migrations, merges or live salon changes were performed. The real user's separate test draft was not reset or edited.

## Checkpoint limits

238 focused tests pass; 7 PostgreSQL concurrency tests are skipped without their attested disposable database configuration. 15 isolated renderer browser tests pass across desktop Chromium, mobile Chromium and mobile WebKit. TypeScript, scoped ESLint and diff checks pass. Mobile automation is not a physical iPhone claim. Full PR CI is not green; this remains a draft and no merge gate is bypassed.

Preserved artwork is PNG/JPG/WebP only, scales as a whole and does not reflow printed text. Updating printed text/photos requires an updated export. Fine-grained editable HTML/CSS generation remains a separate existing choice. Dense or ambiguous link areas still need owner checking and may be corrected manually or in chat. This checkpoint adds working Canva link preservation; it does not declare the full AI Business Setup essential release complete. Broader staff/settings coverage and remaining release hardening continue separately.


## Screenshots

The fixture and all screenshots below contain synthetic business/customer information.

| Step | Evidence |
| --- | --- |
| Original artwork | [PNG export](synthetic-original.png) |
| Owner upload choice | [Keep my Canva design](owner-upload.png) |
| Owner prompt and progress | [Input](owner-input-0.png), [loading](owner-loading-0.png) |
| Editable links | [Owner controls](owner-link-editor.png) |
| Artwork check and exact review | [Artwork checked](artwork-reviewed.png), [review](exact-review.png) |
| Publication | [Published](published.png) |
| Final website | [Desktop](published-website-desktop.png), [mobile](published-website-mobile.png), [unaltered rendered artwork](published-original-artwork.png) |
| Later price correction | [Draft $70 warning, live $65 preserved](changed-price-preview-warning.png) |
| Original booking flow | [Customer review](original-booking-review.png), [appointment confirmed](original-booking-confirmed.png) |

On the final hosted build, a manual draft-only price change to $70 showed the warning and the current proposed service price separately from the fixed image. A separate public browser still received the approved $65 service. The draft was restored to $65 without publication; both existing synthetic appointments remained intact.
