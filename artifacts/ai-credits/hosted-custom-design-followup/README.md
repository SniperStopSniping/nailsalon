# Hosted custom-design follow-up

This supplements the earlier [owner-to-booking checkpoint](../hosted-owner-checkpoint/README.md).
All writes used the actual owner or original customer interface, synthetic records,
the isolated Preview database and Development authentication. SQL observations were
read-only. No production data, live charges, notifications or calendar writes were used.

The current public test is
https://luster-ai-builder-test.vercel.app/en/studio-c58c6f3a375d43d0/book/service?publishedWebsite=1.
It shows the approved dark design at revision22. Its application deployment is
`609d6329a24084ad46e7640514cff2b2deb5687e`; the separate renderer later received the
committed document-language fix from `a49125a66435a76f91465697672416841df013d9`.
This evidence does not claim the later combined release candidate passed CI.

## Real generation and discovered defects

- A fresh mobile WebKit context signed in natively, loaded the existing salon and
  resumed after refresh without reusing storage state, spending credits or creating
  another business. See [fresh-device proof](hosted-fresh-mobile-proof.json).
- A text-only owner brief generated a genuinely different charcoal/ivory design:
  asymmetric split hero, oversized vertical lettering and custom floating service
  cards. The first immutable source is revision15. Its desktop document was1491px
  wide at a1440px viewport. That failure is retained in the
  [first-result observation](first-text-quality-observation.json). A real chat
  refinement created revision16 and corrected overflow without manual source repair.
- The first reset also dropped approved contact details before generation. This was
  an application reset bug, not proof the model ignored supplied contacts. The
  `609d6329` fix preserves published approved contacts while clearing unapproved
  replacements, selected references, photos and the outgoing custom design.
  [A subsequent actual reset](hosted-reset-corrected-proof.json) verified the fix.
- An own-design upload followed by the short prompt “Just get all the info from my
  image.” extracted contact information, public intersection directions and readable
  policy copy. The application also updated the existing custom design automatically.
  Tiny deposit/payment/guest/late-arrival text was flagged as unreadable rather than
  invented. The business identity and service prices were kept; no deposit was
  enabled. The private image and raw extraction are deliberately excluded from Git.
- With the corrected reset and responsive generation guidance, the same text brief
  produced revision21. Its first result fit320,390,768 and1440px with no offscreen
  controls. Bound Instagram, email and phone links, canonical75/75min and50/60min
  service cards were present. Preview booking showed the disabled-booking notice and
  sent zero appointment POSTs. See [render proof](hosted-corrected-render-proof.json).

[Exact prompts, model identifiers, revisions, timings, tokens and rates](model-steps.json)
include all four follow-up operations. Source/design revisions remain in the isolated
database. No hand-authored design or hidden source repair replaced a model response.
The first mobile capture is retained; the original full desktop capture was overwritten
by the harness, so only the first desktop measurement and immutable source are claimed.

## Edit, approve, publish and book

An explicit manual wording edit through the owner UI changed only `hero-footnote` to
“YOUR NEXT FAVOURITE SET.” at revision22; CSS and interaction source were preserved,
and no AI call occurred. This is disclosed as a
[manual owner edit](hosted-dark-manual-proof.json), not automatic model repair.
The preview updated immediately. The exact displayed revision22 was then approved and
published, with the [publication receipt](hosted-dark-publication-proof.json) confirming
media finalization and unchanged canonical services and the earlier appointment.

A signed-out mobile WebKit customer selected the generated service's booking button,
then completed Luster's original service, artist, availability and confirmation flow.
Availability returned200 and appointment creation201. The new appointment was75CAD
for75minutes with the eligible artist; the earlier70CAD appointment and its historical
snapshots remained unchanged. [Booking proof](hosted-dark-booking-proof.json) records
one new appointment and zero AI calls. The actual booking management receipt was
followed separately; its capability URL and customer response remain private.

## Cost and quality limits

The cumulative hosted synthetic-owner trial used15 completed real model calls,
estimated US$0.376808 / CAD0.5275312 at the application's versioned1.4 accounting FX.
These are token/rate estimates, not invoice reconciliation. Owner credits are a
separate prepaid ledger. [Accounting proof](hosted-accounting-proof.json) confirms
zero held reservations, unchanged other-tenant fingerprints and the original shared
CAD80 testing cap. Each ordinary booking incurred zero AI API cost.

The dark and earlier pink sites are materially different generated frontends, not
recoloured presets. This still does not prove five-reference visual acceptance, exact
Canva fidelity, photo-overlap editing or every supported interaction. Original salon
photos were not supplied, and another business's photos were not copied.

A fresh iframe audit after the renderer fix confirmed valid `lang="en"` and no
language-rule violations. Five contrast checks remained incomplete; manual review
found a pale decorative caption crossing light and dark panels on mobile. The source
prompt was subsequently strengthened, but a new model result from that guidance has
not yet been tested. [Accessibility proof](renderer-language-proof.json) makes no
full WCAG claim. Fixing one caption through chat is not sufficient evidence that all
future generated websites have accessible contrast.

Harness-only corrections: preview controls use a disabled-booking notice rather than
HTML disabled attributes; native sign-in automatically opens the saved builder; the
read-only observer recovered from a closed PostgreSQL connection without repeating a
paid operation. The API provider results and successful appointments were not mocked.

## Viewable evidence

- [First text-only mobile result](hosted-text-only-first-mobile.png)
- [Corrected first desktop result](hosted-corrected-desktop.png),
  [mobile](hosted-corrected-mobile.png), [320px mobile](hosted-corrected-narrow-mobile.png)
- [Manual wording edit](hosted-dark-manual-edit.png)
- [Exact review](hosted-dark-exact-review.png), [publication](hosted-dark-published.png)
- [Settled original-booking receipt](hosted-dark-customer-receipt.png)

Remaining release gates include the final combined dependency/browser/PostgreSQL CI
checks, complete reference-quality and accessibility acceptance, isolated hosted
manual-Canva media claim/transfer, and separately verified production configuration.
This is a tested isolated checkpoint, not a production release or completed-builder claim.
