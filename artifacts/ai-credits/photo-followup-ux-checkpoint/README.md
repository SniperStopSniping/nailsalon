# Photo follow-up efficiency and mobile verification

Base `6e0193ea8d812472e10785ad0300e5df551a1c43`. This continues the same builder work; Production/main and pricing are unchanged.

## Source changes

- Native-photo instructions can reuse the existing saved Canva context without attaching the known original reference image to another intake call. This permits the existing Luna conversation model instead of an unnecessary Sol vision call. The optimization cannot apply or authorize actions; the model output still passes the same strict action schema, owner/salon/media checks, draft revision validation and exact publication boundary.
- Reuse requires an existing Canva source, a bounded photo-oriented message and the reference identity already present in the saved artifact's asset list. Explicit reading/extraction requests still include the original image. New references, including a new image with an identical filename, still receive vision input. Missing provenance falls back to reading. Context explicitly marks which reference contents were actually supplied, so metadata cannot be presented as a fresh extraction.
- The Gallery layout contract now supplies owner-facing labels and explicitly maps “make the first photo larger” to **Large first photo**, including a change from **Scrollable gallery**. A clear reorder and layout change should apply together without an extra confirmation. Internal layout names should not appear in ordinary replies.
- The current Canva page is excluded from available native-photo choices and server-side use actions. It is not offered as the default Gallery replacement just because the normalized artwork shares private photo storage. Existing saved photos remain readable; original artwork is not changed.

## Local checks

323 backend/integration tests across 12 files and 85 owner UI tests across 5 files passed. Scoped TypeScript and changed-file lint passed. After an equivalent regexp minimum-quantifier lint correction, the 19 routing tests passed again. New integration coverage verifies the actual model request omits known artwork for a photo edit, preserves vision for an explicit read/new same-named upload, applies through the shared draft and rejects the current page as a forged Gallery choice. These deterministic checks do not establish real-model quality or a measured hosted cost reduction.

## Chrome verification of the existing saved source

The preceding real-provider photo draft was restored through the owner control as private revision **90** on hosted source **8ad19711**. A fresh Chrome Development sign-in loaded the same saved source and photos, independently of the in-app browser session. No credentials were printed, copied to Production, changed or added to application code.

At 390×844 in Chrome, the isolated frame scrolled from 1449.5 to 1982 using the normal browser scroll control. Both native photos completed loading: portrait 480×960 rendered 358×716; wide 1200×480 rendered 358×143.195. [Loaded mobile Gallery](chrome-gallery-mobile.png). This resolves the earlier lack of a mobile Gallery screenshot; it verifies Chrome at phone dimensions, not a physical touchscreen or Safari.

Clicking the model-generated **Show all appointments** area left the private-preview URL unchanged and displayed **Booking is disabled in this private preview.** [Disabled booking state](private-booking-disabled.png). The existing server-side preview creation guard remains covered separately in automated tests. The attempted optional raw-CDP touch gesture was unavailable and did not run; no touch-emulation state was left enabled. Viewport overrides were reset.

## Real-provider acceptance of the update

Exact source **b738fca4027822d210328318356f05f07cbe774a** reached READY as isolated Preview **dpl_FhrEbdq5wZ8gTomM1YtDMADqoeAZ** and was assigned only to the existing test alias. The unique deployment and served alias health responses identified that source, with DB/Redis healthy and outbound email/Calendar configuration absent. Overall health is still degraded; this is not complete release qualification.

Through the normal owner UI, the saved Gallery was changed back to **Scrollable gallery** and the same original design was reattached. The upload deduplicated to its existing saved identity, verified read-only before the request. On the new committed build, the owner sent **“Put the wide photo first and make it the larger first image in the Gallery. Leave the artwork, links, services and settings alone.”** [Submitted request](real-request.png).

One real OpenAI **gpt-6-luna** call completed and saved revision **93**, with the wide image first and **Large first photo** selected. It asked no clarification and started no full-site generation. [Actual result](real-result.png). The original reference chip remained attached throughout; the owner did not have to detach it to receive the cheaper model path. The manual photo choices now exclude the current Canva page. [Choices](clear-photo-choices.png).

Measured usage: **7,116 input tokens, 138 output tokens, 10.308 seconds provider time**, estimated **US$0.000959** using the recorded rate policy. The conservative operator ledger charged **CAD0.001918**, not a claimed FX conversion. This is one successful trial, not a guaranteed price/latency for every edit or an independently reconciled invoice. Raw provider output/source are retained privately; [safe proof](real-provider-proof.json) records identifiers and usage. Source comparison verified the original pages, links, photo identities/dimensions and business/services/staff/policy draft values stayed unchanged except the requested photo order/layout.

The owner used **Restore earlier draft** afterward. Head **94** restores the original source; publication **77**, all existing appointments/services/staff and the other businesses were preserved by read-only checks. No publication, appointment, purchase, credit grant or budget increase occurred in this trial. Operator usage is **CAD36.029848** against the unchanged lower **CAD68.615594** ledger cap, within the user's CAD80 ceiling.

New asset-backed photo publication/booking and the remaining complete-builder release gates stay open; PR #461 remains Draft. The supplied artwork still has the previously documented low-resolution and printed-business mismatch limitations; this trial improves photo editing, not those source pixels. Production/main remain unchanged.
