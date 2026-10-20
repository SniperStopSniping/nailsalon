# Real reference generation, recovery and original bookings

These are real owner-facing trials in the isolated hosted Preview. Generation ran on `f7389730d3daf4ee7898fb767a76bf6eb3437ada`; the repeat-reset walkthrough and final burgundy publication/booking ran on `d0e7519b3a89f1b9256616e317e9e04383222de9`. No Production deployment, migration, salon write, notification or real payment occurred.

## Same short owner prompt, different generated frontends

For each reference, the owner chose **Start over → upload image → Inspiration**, uploaded the supplied image and sent:

> Make my website look like this. Use my saved business details.

Approved business information and canonical service identities, prices, durations, opening hours, staff eligibility and booking agreement stayed saved. Old selected photos were cleared. Another business's artwork was treated as inspiration; its photos, logo and written content were not imported as the test business's assets.

| Trial | Actual revisions | Models | Wall time | Estimated provider cost, CAD |
| --- | --- | --- | --- | --- |
| Pink floral reference | 52 → 53 | gpt-6-luna + gpt-6.1-sol | 129.718s | 0.0932344 |
| Pink mobile-arrow refinement | 53 → 54 | gpt-6-luna, two controlled calls | 59.393s | 0.0068054 |
| Burgundy editorial reference | 57 → 58 | gpt-6-luna + gpt-6.1-sol | 120.160s | 0.0869092 |

These estimates use recorded tokens and versioned application rates at configured accounting FX1.4 CAD/USD, not invoice reconciliation or a current exchange-rate quote. All six provider calls completed with passed validation. The original and final provider outputs and source revisions are retained privately. There was no manually authored replacement, hidden generated-source repair or model-repair pass in these trials. They do not represent the cost of ordinary bookings.

The pink follow-up was: “Make the little down-arrow a clearer, bigger button to tap on mobile. Keep everything else.” HTML and interaction source stayed unchanged; the model changed CSS. The burgundy trial refreshed the owner page during generation: its cleared composer and pending request resumed, and the first finished preview opened automatically.

## Visual result and limits

The pink result uses blush panels, large script hierarchy, rounded composition and original botanical SVG decoration. It does not reproduce the reference's portraits, nail-photo collage or lily photography; no owner photos/logo were supplied. The burgundy result uses a deep wine canvas, oversized serif hero, thin editorial rules, a two-column desktop contact/visit section and a stacked mobile arrangement. It substitutes original line decoration for the reference's rose strip and monogram. These are distinct model-built frontends, not exact Canva reproductions or recoloured Luster presets. Pixel fidelity, copied branding and the complete five-style matrix are not claimed.

[Pink desktop](hosted-pink-floral-desktop.png) · [Pink first mobile](hosted-pink-floral-mobile.png) · [Pink refined mobile](hosted-pink-floral-final-mobile.png)

[Burgundy desktop](hosted-burgundy-editorial-desktop.png) · [Burgundy mobile](hosted-burgundy-editorial-mobile.png) · [Burgundy policy](hosted-burgundy-editorial-mobile-policy.png)

Both designs were exercised at320,390,768 and1440px with no horizontal overflow or offscreen controls. Prices65/50/35 CAD and durations75/60/45 minutes came from live draft bindings. Instagram, email and phone anchors resolved to the approved synthetic contacts. The canonical booking agreement matched. Private preview Book Now produced no appointment POST and explained that booking is disabled. The generated frame could not read the parent document.

Mobile axe reported zero violations, but manual contrast review remains open: pink had one incomplete rule target; burgundy had five. This is not a complete WCAG conformance claim. Sources, first results and diagnostic failures remain preserved.

## Exact approval and original booking engine

Pink54 was reviewed and published with one finalized receipt. Replaying54 returned200; replaying older49 after54 did not downgrade the newer site. A signed-out WebKit/iPhone customer then booked Express natural-nail manicure35 CAD/45min through Luster's existing service, eligible-staff, availability and confirmation flow. The appointment POST returned201; all five older appointment rows retained their fingerprints.

Burgundy58 survived reset/restoration as the identical artifact in64. Exact64 review and publication produced one finalized receipt; replay returned200, with all six older appointments preserved. A seventh original WebKit booking completed for Express35/45 on2026-10-21 at10:00 America/Toronto, with the canonical service and eligible technician IDs, matching price/duration snapshots and201 response. All six earlier appointment fingerprints stayed unchanged. Neither booking used an AI call.

[Burgundy review](hosted-burgundy-editorial-exact-review.png) · [Original booking confirmation](hosted-burgundy-editorial-booking-confirmed.png)

## Repeat reset: failure, source fix and hosted proof

The oldf738 UI really reopened Start Over with only **Retry**, hiding the fresh idea choice. A regression test failed before the change. Thed0 fix renders the retry state from the actual error, retaining the operation identity for uncertain-response retries. Seven reset and39 related editor tests pass.

The final hosted cycle62 → 63 → 64 confirmed both new-image and new-idea choices reappear after success, Retry is absent, cancelling causes no write, the earlier generated source restores and refresh retains it. Canonical business/services/policy/hours, six existing appointments and published values stayed unchanged; no AI call was made. Earlier58-to60 and60-to62 attempts completed their UI/domain steps but their measurement compared too much: the intentional manual draft projection and automatic updated_at timestamp also change. The final proof excludes only those known fields and compares all published/other salon fields. No application or generated-source change was made to satisfy that measurement correction.

[Reopened choices](hosted-d0-reset-reopened-two-choices.png) · [Restored draft](hosted-d0-reset-restored.png)

## Current fresh-owner gate

A genuine new WebKit context, without copied cookies/storage, submitted the native Development signup form. The first bot-test attempt used an expired testing token and failed; refreshing the official bot-testing token allowed native signup200 without response/session manipulation. The user remains unverified with a pending choose-organization task. The app's actual organization POST returned503 `ORGANIZATION_SETUP_UNAVAILABLE`, which the endpoint emits for provider403 `organization_quota_exceeded`. No Luster salon, wallet purchase or model call was created. This is current failure evidence, beyond an inferred organization count.

The account must not be assigned another tenant's organization or bypass ownership. The separate5792e2b5 source fix gives fixed support copy and hides the unusable organization form, removing the false claim that a salon already exists. Its new regression was red before and43 related auth/verification/organization-route tests, full TypeScript and lint pass. That copy fix was not on thed0 hosted runtime in this evidence. Quota resolution and full fresh-owner acceptance remain release gates.

## Evidence handling

The JSON proofs and PNG screenshots are curated synthetic data. Input reference hashes and basenames identify the private owner-supplied references; the reference images, raw provider responses, auth states, keys, Checkout URLs, booking-management capabilities and share capabilities remain outside Git. Immutable comparison previews exist separately; their Book Now controls are disabled. A convincing preview is not substituted for the booking proofs above.
