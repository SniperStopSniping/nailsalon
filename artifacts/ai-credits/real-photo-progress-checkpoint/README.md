# Real photo-based owner generation and saved progress

This ran through the actual owner application at
https://luster-ai-builder-test.vercel.app on committed Preview source
`9fd36c0aa7d998a8889a8d83fc714a944bfcdd0c`. Its source-identical commit-message
correction is `0f9e4e69c1d68fd3bcd9e735005c2724697a84cf`.
No Production deployment, migration, credential inspection, purchase or credit
grant was performed.

## Owner path and real model output

Start over saved the existing draft and retained the salon's confirmed business,
three services, prices, durations, hours and booking rules. Through the existing
Photos & design settings controls, the owner selected two already uploaded,
**synthetic test graphics**: a480x960 portrait and a1200x480 wide image. These
verify image provenance and very different aspect ratios, not photography quality
or fidelity to a Canva reference. No inspiration screenshot was selected.

The owner entered this message once:

> Create a dark, premium booking website using these photos. Large overlapping
> images, elegant typography, and a spacious phone layout. Use my saved business
> details.

[Owner input](owner-input.png), [saved generating stage](generating-desktop.png).
The composer cleared immediately. A deliberate refresh during generation resumed
the same accepted request and pending generation. The saved stage was present in
the accessibility tree; the [phone owner capture](resumed-owner-phone.png) does
not show that specific line within its visible scroll area. It is evidence of
resume, empty composer and the pending credit hold, not complete proof of phone
progress visibility. No request was resubmitted after refresh.

Real OpenAI `gpt-6-luna` interpreted the request; real `gpt-6.1-sol` generated the
first custom HTML/CSS and constrained interaction source. Revision125 stores
artifact`a615870a-e709-4c2f-a096-e6b0eea81d2d`. No developer authored or repaired its
website source, and no automatic repair was needed. Both original model outputs
remain private in the AI-call records and immutable source artifacts.

The owner then sent once:

> Make the mobile version less crowded. Keep the overlapping images, services,
> prices, and desktop design unchanged.

Luna interpreted and implemented that bounded edit. Revision126 stores
artifact`35c7137f-5def-4521-803a-68afcdc200ae`, with125 as its source parent.
HTML, JavaScript and the CSS before the phone breakpoint are byte-identical.
Only the existing max-width700/360 phone rules changed. Every non-website draft
field remained identical. [Generated desktop](generated-desktop.png),
[actual390px phone](generated-phone.png). The rendered phone document and its
scroll width were both390px. Both images loaded, with the correct480x960 and
1200x480 originals. The portrait retained a contain fit, and the wide graphic
kept its2.5:1 ratio in the overlapping composition.

The service buttons used the three correct `setup_preview_`-adapted canonical
service identities. Displayed prices/durations were BIAB65/75minutes,
Gel50/60minutes, Express35/45minutes. Instagram, phone and email were actual
`https://www.instagram.com/`, `tel:` and `mailto:` links, using saved synthetic
contact values. Link attributes do not prove external-account existence or
message delivery.

## Exact review, restoration and preservation

[Review126](exact-review-126.png) showed only design mode, reference selection,
photo selection and source changes. It correctly said **Use the design shown in
Preview** for the cleared optional mode. No price, schedule, staff, address or
policy changes were proposed. The owner did not approve/publish this design.

Restore earlier draft returned the original source at revision127. The complete
draft matched the pre-test draft except its expected session/history markers.
The published artifact and finalized publication98 stayed unchanged. Read-only,
TLS-verified checks against the pinned Preview database confirmed every prior
service, staff, appointment, uploaded asset and other salon row still matched its
before digest. The target salon's live source remained unchanged throughout.
The new first/revised source artifacts and authenticated previews remain saved.

This particular trial does not claim a new published-customer booking. Existing
real reference-based generation/publication/bookings are documented in
[hosted reference acceptance](../hosted-reference-reset-checkpoint/README.md),
and the separate [manual Canva checkpoint](../manual-canva-owner-checkpoint/README.md)
proves the manual route. They must not be represented as bookings from125/126.

## Measured usage and limits

Four real provider calls: initial orchestration, first frontend, edit
orchestration and targeted frontend revision. Initial frontend provider time was
97.089seconds; targeted frontend revision35.282seconds. No call failed or retried.
Token-based provider estimate **USD0.064843**; conservative budget charge
**CAD0.129686** using the existing2CAD/USD operator conversion; separate synthetic
credit-wallet charge **CAD0.181563**. These are application usage estimates, not
an invoice or spot exchange rate. The hosted meter ended **CAD36.311494** within
its existingCAD68.615594 allocation; the separate local allocation remains part
of the overall authorizedCAD80 ceiling. No cap or pricing setting changed.
[Call IDs, models, usage, source hashes and preservation assertions](generation-proof.json).

These synthetic images do not demonstrate accurate reproduction of a customer's
photography or a fifth distinct reference. Full physical-device/accessibility and
combined release qualification remain outstanding. The current CI run39349089161
remained running while this evidence was captured. Its commit-message failure
was corrected locally without changing source. The separately observed Next15/webpack5.112 Storybook
compatibility failure remains a release dependency. PR461 stays Draft and
Production stays NO-GO.
