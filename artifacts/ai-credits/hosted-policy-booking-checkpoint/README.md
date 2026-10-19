# Saved booking agreement → generated design → original booking

This real owner-facing trial ran on isolated Preview source
`844ef5e684ca76fe63eddc0971391b546054ef09`. Production was not changed.
The public synthetic salon is [Cobalt Nail Club](https://luster-ai-builder-test.vercel.app/en/studio-c58c6f3a375d43d0/book/service?publishedWebsite=1).

## First attempt and resulting application fix

The owner asked: “Show my saved booking agreement on the website, in the rounded
policy area before services. Keep the sage design and my services.”

On earlier source `43a4436e`, the model copied the agreement into separate website
text rather than changing its existing presentation setting. Revision 35 rendered,
but failed functional acceptance: the copied text could drift from the saved
policy. It was **not published**. [The failed result is retained](first-attempt.json),
along with the original provider responses and immutable source in the isolated
database. No hidden source repair was used.

The application now has a narrowly validated policy-visibility action, trusted
policy bindings in the renderer, semantic validation with bounded AI repair,
and coverage validation before publication. The action preserves the agreement's
wording, acknowledgment and other settings. It cannot be activated by untrusted
upload content. It changes where an existing agreement appears; it does not create
a deposit rule or another policy engine.

## Same prompt through the actual builder

The identical prompt on `844ef5e6`, in website-only mode, produced revision 37.
One real Luna conversation call and one real Sol frontend call took 76.613 seconds,
costing an estimated US$0.060828 / CAD0.0851592 at the trial's 1.4 FX assumption.
The first output passed validation without an AI repair. These are token-based
estimates, not a reconciled invoice or a future-price guarantee.
[Exact models, tokens, cost and artifact](model-generation.json).

The generated design uses the current canonical agreement. The obsolete copied
section was removed. Services, prices, durations, staff eligibility, hours and
booking rules stayed unchanged; CSS, JavaScript and language were byte-for-byte
unchanged from the preceding design. [Preservation proof](design-preservation.json).
The owner did not re-enter business details or edit generated source.

Fresh captures at 320, 390, 768 and 1440 pixels had no horizontal overflow or
offscreen controls. Bound prices, durations, agreement, Instagram, phone and email
matched the draft. Booking from private preview was blocked and made zero
appointment POSTs. The opaque renderer could not read the parent document.
[Rendering checks](render-proof.json). Three targeted axe rules for document
language and contrast reported zero violations/incomplete results; this is not
a full accessibility audit. [Targeted result](targeted-accessibility.json).

This remains an inspired custom composition, not an exact reconstruction of the
sage reference: it has an original SVG botanical illustration and one agreement
panel rather than the other salon's photographic garland and four policy cards.
It does not copy that salon's deposits or other business claims.

## Exact approval, publication and booking

The actual Review screen showed the policy-display change. The owner approved
revision 37, and publication completed with media finalized. Retrying the exact
request returned 200 with one publication receipt, no duplicated services and the
three prior appointments unchanged. A presentation-only policy change correctly
did not ask for the existing-appointments acknowledgment.
[Publication proof](publication-proof.json).

A fresh signed-out WebKit customer, using iPhone 13 emulation and Playwright
1.55.1, selected the generated Gel manicure card. It carried the real service ID
into Luster's original service/staff/calendar/confirmation flow. Availability
returned 200; appointment creation returned 201. The new record and historical
service snapshot contain CAD50, 60 minutes and the eligible saved staff member.
The prior three appointments stayed unchanged. This fourth synthetic appointment
made **zero AI calls**. [Original-booking proof](original-booking-proof.json).

The first confirmation screenshot was captured during its entrance transition;
the database/201 proof is authoritative. A separate settled receipt capture, if
included, is an existing-booking read and does not create another appointment.
Raw customer responses, capability links, auth state, provider responses and
uploaded private source remain outside Git.

- [Desktop design](generated-desktop.png)
- [Mobile design](generated-mobile.png)
- [Agreement in the mobile design](canonical-agreement.png)
- [Exact review](exact-review.png)
- [Successful isolated publication](published.png)
- [Settled original booking receipt](settled-original-booking-receipt.png)

This checkpoint proves a saved-information return visit, generated policy binding,
exact publication and the original booking flow. Five-reference fidelity,
fresh-account onboarding, the complete accessibility review and final combined
dependency/CI qualification remain release gates. It does not mark the whole
builder complete.
