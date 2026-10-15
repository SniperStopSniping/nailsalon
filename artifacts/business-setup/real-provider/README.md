# Real owner workflow evidence — 2026-10-14

This evidence uses the actual owner application with OpenAI `gpt-6-astra`, a
loopback-only Development database, synthetic owner/customer accounts, blocked
outbound browser requests, and no notification/payment credentials. No generated
HTML/CSS was substituted with a hand-authored design or manually repaired.

## Results

- Business-first conversation saved private home address, city-only display,
  Toronto time zone, Tue–Sat hours, solo ownership, services and clearly unapproved
  illustrative prices/durations. Input: `03-business-intake-input.png`.
- Text-only pink editorial brief plus authorized salon photos generated a custom
  frontend. First response (98.756 s) and automatic repair (67.628 s) were retained.
  Both initially hit overly narrow image-attribute validation. Application support
  for safe `loading`, `decoding`, `fetchpriority` hints was added and tested; the
  owner used **Check and apply saved result without generating again**. The exact
  retained repair source was revalidated and applied, with no source edits.
- Two uploaded reference screenshots generated substantially different cream
  editorial and dark/gold sites on the first response (77.906 s and 75.577 s).
  Reference-input screenshots and desktop/mobile results are adjacent files here.
  References are disclosed hand-authored fixture screenshots used ONLY as input;
  they are not claimed to be model output or real Canva exports. Salon photographs
  are existing authorized Isla assets. Actual Canva-export trial remains pending.
- Owner chat redesigned the hero, enlarged/overlapped images, moved services above
  the gallery, reduced mobile crowding, and changed BIAB to CAD65. Price changed
  canonical draft service data while retaining 75 minutes and identical source.
  Each design was a separately saved model-generated artifact; revision IDs and
  usage are in `usage-evidence.json` and private DB evidence.
- Refresh retained the conversation and designs. Explicit manual editing changed
  an editable text field, survived reload, then the owner restored the preceding
  real AI artifact before publication. This was a disclosed editability test,
  not a developer repair presented as automatic generation.
- Exact review approved revision14. Publication committed successfully, then its
  response was deliberately dropped. Reload recovered the receipt; retry returned
  the same receipt. Exactly two live services and one publication existed.
- The published custom service card used its real Luster service identity to enter
  the original booking flow. Availability, customer details, policy acceptance and
  appointment creation completed. DB: exactly one appointment, CAD65 / 75 minutes.
  `35-original-booking-review.png`, `36-original-booking-confirmed.png` and receipt
  metadata record this result. No email/SMS/payment was sent.

## Visual assessment and intervention

Cream reference: preserved oversized serif/italic hierarchy, offset rotated
photography, warm neutral palette, asymmetric gallery and green footer. Dark
reference: preserved black/olive background, gold accents, oversized serif hero,
organic image cropping and service/gallery hierarchy. Neither is a pixel-perfect
copy: system fonts, own photos and rewritten business content deliberately differ.
No claim of perfect recreation, professional designer parity or broad style
coverage is made. Five-style/real Canva testing remains incomplete.

A genuine runtime defect appeared after the full-photo hero revision: using the
iframe document height to resize its viewport made `vh` heroes grow repeatedly.
Fixed the shared renderer host to retain a stable browsing viewport and scroll
within it. This changes no generated source. Regression test plus actual desktop
and mobile measurements passed (1280x852 and390x796 frame viewports; mobile hero
840px, no horizontal overflow). Files37–38 show the corrected render. Earlier
oversized diagnostic captures are preserved outside the repository in
`/tmp/luster-ai-real-provider-evidence-20261014` and are not acceptance evidence.

## Cost and limits

Ten actual calls completed. Provider-reported tokens imply USD3.192203 at the
configured rates, conservatively charged as CAD6.384406 using 2CAD/USD (accounting
allowance, not an FX quote). Local ledger cap is frozen at that consumed amount.
Hosted trial may reserve at most CAD33.61, keeping combined allowance below CAD40.
Raw model results and uploaded references remain private in the local database;
logs and this report contain no keys or raw private conversations.

## Still incomplete

Hosted access verification; actual Canva export and remaining visual styles;
menu-document extraction; complete staff/policy configuration and existing-hours
appointment-impact review; broader browser/accessibility fidelity evaluations;
production asset lifecycle, operating controls and independent sandbox review.
This is a functional private pilot, not the completed release or production-ready
builder. The original application/manual paths remain available.
