# Restoring a real generated design, resuming on a phone and publishing $65 BIAB

This checkpoint ran through the actual owner/customer application on isolated
Preview source `f7389730d3daf4ee7898fb767a76bf6eb3437ada`. The application deployment
was READY, its exact Git SHA/project/Preview target were verified, and the dedicated
test alias was updated. Production was not changed. Generic Preview health remains
degraded for the separately documented unconfigured integrations; a READY deployment
is not a claim that every integration is healthy.

## Human-readable design recovery

Previously, the history showed identical salon titles with indistinguishable
restore buttons. The new UI shows the save time, original design request when
available, and a Current design marker. Restoration is disabled while generation
or newer saved preview data is loading. The scoped change passed 22 focused tests,
full TypeScript, lint and secret scanning before this hosted trial.

From draft46, the owner selected the visible request “Completely redesign the hero.
Keep my services, gallery and contact details.” Its saved source became draft47.
The owner then restored the most recent manual-wording version into48. Both actions
preserved the unconfirmed BIAB65 proposal, every other business setting and all four
appointments. Live BIAB stayed75. Refresh retained the restored source and the
manual “Colour notes from the garden” heading. No model call was made.
[Restoration proof](restoration-proof.json), [actual history UI](choose-earlier-design.png).

## Genuine new-device resume

A fresh WebKit/iPhone13 browser context signed in through the AI introduction
screen using the existing synthetic owner's real Development password. It received
native Clerk cookies; no auth state/cookies were copied and no legacy admin session
was manufactured. The official Development bot-testing token only bypassed bot
detection. The same owner and salon loaded draft48, including the unconfirmed65
price and manual wording, and retained the exact draft after refresh. This made no
model calls or appointments. [Proof](new-device-resume-proof.json),
[phone screenshot](new-device-resumed.png).

This is an existing-owner new-device test, **not** fresh registration or organization
creation. Fresh registration and organization creation on the current Development instance
remain unverified; the earlier creation failure is being rechecked. A count of
50 organizations alone does not establish creation capacity. Later routine testing reused the authenticated owner session in a
non-recording context; that reuse is not presented as another fresh login.

## Exact approval and original booking

The owner confirmed the displayed proposed price/time, creating49. Review showed
BIAB75→65, unchanged75 minutes, two new website photos and the new generated design.
The exact49 was approved and published. Media finalized, and replaying the same
publication request returned200 with exactly one receipt and three service records.
Hours, address, booking settings/policy, staff and eligibility remained unchanged.
The four existing appointments were byte-for-byte unchanged.
[Publication proof](publication-proof.json), [exact review](exact-review.png).

A new signed-out mobile WebKit customer selected the published BIAB card, carrying
its canonical service ID into Luster's original booking flow. Real availability
returned200 and the original appointment endpoint returned201. The fifth synthetic
appointment records65CAD,75 minutes, the correct eligible staff member and matching
historical service snapshot. The prior four keep their original70/75/35/50 prices
and appointment lengths. The booking made **zero AI calls**.
[Original booking proof](original-booking-proof.json),
[settled receipt](original-booking-receipt.png).

The settled receipt was a separate read using the original private management
capability; it created no appointment and preserved all five records. That capability,
raw responses, provider output and auth state remain outside Git. The short initial
confirmation capture occurred during its entrance transition; the settled receipt
and underlying201/database checks are used for review.

All default axe rules found32 passes, zero violations and zero incomplete results
for the generated renderer document at390 and1440px. This supplements the four-width
layout/binding/preview-isolation checks in the preceding checkpoint. It does not
certify the entire admin, every generated future site, manual keyboard behavior or
full WCAG compliance. [Mobile](generated-mobile-accessibility.json),
[desktop](generated-desktop-accessibility.json).

At publication49, the hosted trial had31 real calls, estimated CAD0.9301432 at
accounting FX1.4, with no held reservations. Restoration, confirmation, publication,
retry, new-device resume and the new booking added zero AI usage. The shared CAD80
test cap remained unchanged. Subsequent visual-reference trials are recorded
separately; the customer URL may therefore show a later approved test revision.

Full dependency/CI qualification, the remaining reference-fidelity comparisons,
hosted manual-Canva claim/transfer, fresh registration and broader accessibility
acceptance remain release gates. This checkpoint does not mark the whole builder
or production launch complete.
