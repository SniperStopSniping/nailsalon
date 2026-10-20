# Real photo uploads and iterative owner chat

These steps used the actual owner-facing builder on isolated Preview application
`844ef5e684ca76fe63eddc0971391b546054ef09`. The generated source was never manually
repaired. Every provider response and immutable source artifact is retained in
the isolated database. Production was not changed.

## Uploaded photos

The owner opened Attach → My photos, selected two differently sized botanical
JPEGs and confirmed permission to use them. These are CC0 stock test photos,
explicitly **not salon portfolio work**. Their individual Commons license pages,
authors, original dimensions and hashes are in [the manifest](photo-licenses.json).

The 4000×3000, 7.77 MB file became a 2048×1536, 247,190-byte WebP. The 3840×2560,
1.81 MB file became a 177,678-byte WebP at its original dimensions. Both retained
their proportions and had EXIF/XMP removed. The originals were task-created downloads;
they were removed only after verifying the saved images and their hashes. The
application's private assets remain available. Uploading made zero model calls,
changed no business settings and did not change the live website.
[Actual upload proof](upload-proof.json).

Playwright's multipart instrumentation omitted some file bytes, so its observed
post-data counts are **not wire-size measurements**. Successful upload responses,
normalized bytes, decoded dimensions and rendered natural dimensions were checked
separately.

## Real chat requests, one at a time

| Owner request | Saved revision | Real model calls | Time | Provider estimate USD |
| --- | --- | --- | --- | --- |
| Add both flower photos as a colour-inspiration gallery before my services. These are stock test photos, not my salon's work. Keep the rest of the design. | 39 → 40 | Luna ×2 | 49.291 s | $0.005332 |
| Make the images larger and overlap them. | 40 → 41 | Luna ×1 | 61.768 s | $0.005066 |
| Put services above the gallery. | 41 → 42 | Luna ×1 | 39.785 s | $0.004343 |
| Make the mobile version less crowded. | 42 → 43 | Luna ×1 | 46.320 s | $0.004563 |
| Completely redesign the hero. Keep my services, gallery and contact details. | 43 → 44 | Sol ×1 | 97.994 s | $0.089469 |
| Keep the design, but change BIAB to $65. | 45 → 46 | Luna ×1 | 5.310 s | $0.000911 |

Models were `gpt-6-luna` and `gpt-6.1-sol`, through OpenAI. Each first generated
result passed application validation; none required automatic repair in these
steps. The first and final outputs are therefore the same for each call. Source
IDs/hashes, token usage, timings and exact prompts are retained in the individual
JSON proofs. There were no manually authored replacement designs.

The gallery uses both selected asset identities, with alt text and stock labels.
At the same embedded desktop width, the first photo grew from approximately
573×255 to 731×390 pixels, and the second from 469×255 to 647×390. Actual image
rectangles overlap. Rendering at 1440, 768, 390 and 320 pixels found no horizontal
overflow. Decoded natural dimensions match the saved uploads.
[Overlap measurements](overlap-geometry.json).

Moving services changed their actual DOM order, preserving CSS and JavaScript
byte-for-byte. The phone-spacing request preserved desktop overlap but gave phones
full-width stacked photos, wider spacing and separate captions.
[Order preservation](section-order-preservation.json),
[mobile geometry](mobile-geometry.json).

Sol's hero is a substantial custom redesign: an asymmetric deep-green text panel,
oversized serif hierarchy, blush booking button and large uploaded botanical photo.
It is not a recoloured preset. At phone widths its text and shorter photo stack.
The pre-existing service section, policy, contact bindings and responsive gallery
remain. Photo cropping in the design is intentional and disclosed by the model.
[Hero generation](hero-generation.json), [responsive geometry](hero-geometry.json).

The first historical-preview capture helper requested revision 40 after revision
41 existed. The application correctly rejected the stale URL; the helper was
corrected to use the current revision. A later helper initially mixed the new hero
image into gallery-only geometry. Its selector was corrected and the four-width
measurements repeated. These were measurement corrections, with no application
source or generated-site repair.

## Manual editing and canonical pricing

Between the hero and price requests, the owner used the visible **Edit website
wording** controls to change “Floral colour notes” to “Colour notes from the garden.”
This intentionally disclosed manual copy edit created revision 45, survived refresh,
preserved CSS/interactions and made zero AI calls. It is not presented as a model
edit or hidden design repair. [Manual edit proof](manual-wording-proof.json).

The $65 request then changed the real BIAB draft, keeping its service identity and
75-minute duration. It did **not** replace an HTML price string or regenerate the
frontend. Other services, the complete design, settings and four historical
appointments remained unchanged. The private bound service card shows $65; the
live service still has $75. The proposed price remains unconfirmed, and the actual
Review screen blocks publication until confirmation and exact approval.
[Canonical price proof](canonical-price-edit.json).

These new visual and price requests total an estimated US$0.109684 / CAD0.1535576.
The complete hosted trial has 31 completed real calls, estimated US$0.664388 /
CAD0.9301432 at accounting FX 1.4. No reservation is held, other tenants' fingerprints
are unchanged, and the shared CAD80 test cap was not increased or reset. These are
usage/rate-based estimates, not invoice reconciliation. Owner prepaid credits and
operator test spending are separate ledgers. [Accounting proof](accounting-proof.json).

- [Owner's gallery request](owner-gallery-request.png)
- [Overlapping desktop photos](overlapping-photos-desktop.png)
- [Overlapping phone photos before the spacing request](overlapping-photos-mobile.png)
- [Roomier phone photos afterwards](roomier-photos-mobile.png)
- [Completely redesigned desktop hero](hero-desktop.png)
- [Completely redesigned phone hero](hero-mobile.png)
- [Visible manual wording controls](manual-wording.png)
- [Unconfirmed-price review](unconfirmed-price-review.png)

At this checkpoint revision 46 is private; the public website remains approved
revision 37. Later restoration/publication/booking results must be recorded
separately. This is not completion of the five-reference fidelity matrix, fresh
registration, full accessibility review or final dependency/CI release gates.
