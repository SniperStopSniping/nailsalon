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

The new cost/context/prompt changes still require a committed Preview and real-provider trial with the original reference left attached. Retain that trial's raw output, usage, source revisions and any remaining clarification. Keep the published example and appointments unchanged and restore the pre-trial draft. New asset-backed photo publication/booking and the remaining complete-builder release gates stay open; PR #461 remains Draft.
