# Real owner-chat generation and revision

## What ran

On the isolated Preview application `https://luster-ai-builder-test.vercel.app`,
runtime0602dd19f55f2a97577c9ef36b30d8aaa3696c12, the already authenticated synthetic
Cobalt owner used Start over → Start fresh with an idea. Revision117 retained
the saved business, three services, prices, hours and booking settings while
clearing the design and selected images. The owner did not enter those details
again. No account, credit grant, purchase, environment change or package install
was needed.

The owner entered this normal request in the actual conversation:

> Create a completely original, high-end editorial booking website. Warm ivory,
> black and a little burnt orange; oversized elegant type, an asymmetrical hero
> and overlapping shapes. No photos. Put services before an About section. Make
> the phone version feel spacious.

[Input](owner-input.png), [accepted/loading](owner-generating.png),
[owner preview](owner-generated-preview.png). The composer cleared immediately;
the saved chat returned after refresh. The configured OpenAI provider generated
the complete custom HTML, CSS and constrained interaction code. No developer
authored, repaired or substituted website source. Automatic contact binding,
validation, storage and rendering were the normal application path. No automatic
AI repair was necessary. Original raw results remain private in `setup_ai_call`;
immutable source artifacts retain both versions and their parent relationship.

## Actual generation and edit

Revision118 / artifact6185e42a-a357-43a2-8af4-d0ea6791b099 is the first result.
It has oversized serif hierarchy, a split asymmetrical hero with overlapping
abstract shapes, ivory/orange/black tokens, three bound service cards before
a dark About section, saved contact links, hours and the complete booking
agreement. There are no invented photos, biography, credentials or reviews.
[Desktop](first-desktop.png), [phone](first-mobile.png).

The owner then sent:

> Make the mobile version less crowded. Give the headline and service cards more
> breathing room on phones. Keep the desktop design and everything else the same.

Revision119 / artifact9e9bec68-ac55-469e-b71f-2c25c711e5fa retained exactly the
same HTML, JavaScript and desktop CSS rules. The model added only phone CSS
overrides. Measured at390×844: headline line height59.15→64.35px; service-card
padding24px→30px25px; the first two cards260→292px tall. Body and scroll widths
both390 before and after, with no horizontal overflow. [Revised phone](edited-mobile.png),
[first service cards](first-mobile-services.png),
[revised service cards](edited-mobile-services.png), [measurements](phone-geometry.json).
Screenshots are original browser captures, not redesigned or sharpened artwork.

The generated phone menu expanded, followed its Appointments anchor and closed.
Instagram, phone and email had correct `https`, `tel` and `mailto` destinations.
Service-button draft identities matched each real service through the normal
`setup_preview_` adapter. Private Book now reported booking disabled; no
appointment was created. [Contact bindings](contact-bindings.png),
[private booking blocked](private-booking-blocked.png), [binding values](bindings.json).

## Measured usage

| Operation | Real provider/model | Input/output tokens | Provider time | Estimated USD |
| --- | --- | --- | --- | --- |
| Interpret initial request | OpenAI/gpt-6-luna |6620/172|3.391s|0.000914|
| Generate first frontend | OpenAI/gpt-6.1-sol |2536/6065|100.580s|0.066989|
| Revise phone spacing | OpenAI/gpt-6-luna |8007/6054|47.774s|0.004028|

Total token-based provider estimate: **USD0.071931**. This is an application
usage estimate, not an invoiced amount. Standard model rates were rechecked
against the official [Sol model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
and [API pricing](https://developers.openai.com/api/docs/pricing).
The conservative operator meter increasedCAD0.143862 using its existing2CAD/USD
budget conversion, which is not a spot exchange rate. The separate synthetic
credit wallet chargedCAD0.201409 under the existing pricing implementation.
Neither product pricing nor conversion settings were changed for this trial.
The shared meter endedCAD36.181808; its stricter existingCAD68.615594 cap remained
below the authorizedCAD80 ceiling. No cap or allowance was raised/reset.
[Call IDs, times, token usage, hashes and edit comparison](generation-proof.json).

## Review, resume and restoration

After a normal refresh, both messages, replies and revision119 persisted without
resubmission, stale composer text or another provider call. The exact review
showed the design/reference changes and existing booking agreement; no price,
duration, schedule, staff or policy changes were proposed.
[Review for119](exact-review-119.png). One minor presentation issue remains in
this captured runtime: a cleared optional design-mode value is described as
“Not set,” even though the generated custom design is visible. The following
source fix describes that case as “Use the design shown in Preview” and retains
“Not set” for genuinely missing contact values. Its owner UI regression also
checks that opening Review does not approve or publish. Neither the issue nor
the copy fix changes booking settings, approval hashes or publication readiness.

Using Previous designs → Restore as draft restored the first model source into
revision120. [Restored design](restored-first-design.png). Restore earlier draft
then returned the pre-test source4c5a3b96-8d6e-4ca3-972c-7129512a3d1d at revision121.
Both AI results remain in history and their authenticated revision previews.
Refresh/restoration made zero additional provider calls.

Read-only, TLS-verified SQL against the pinned Preview database confirmed:
20 salons,52 services,15 staff,32 appointments and62 uploaded assets remained.
Every prior service, staff, appointment, asset and other salon row matched its
before digest. The target salon's final business/configuration matched, with only
its ordinary `updated_at` metadata changed. Published source and finalized
publication98 were unchanged throughout. [Preservation receipt](preservation.json).
No Production data, deployment, migration or external message/payment was made.

## Source improvement and limits

The running app only displayed generic Working text during the paid requests.
The accompanying source change exposes actual saved generation stages through
the existing authorized history route and shows plain-language generating,
checking, correction and saving messages. It does not invent percentages or
resend a request. Domain/route22 tests, owner UI48 tests, validator35 tests and
Canva publication53 tests passed locally, plus scoped types and changed-file lint.
Those deterministic tests are distinct from the three real provider calls above.

This trial proves original text-to-frontend generation, an actual bounded model
revision, isolated desktop/phone rendering, saved conversation, review and source
restoration. It is **not** a new reference-image fidelity trial or publication/
customer-booking test for this new design. The owner's existing published example
was deliberately preserved. The separate [manual Canva owner/customer checkpoint](../manual-canva-owner-checkpoint/README.md)
proves exact publication and a signed-out original booking, but must not be
represented as this AI-generated design's booking acceptance. The remaining
Chrome first-load qualification is documented [separately](../frame-session-runtime/README.md).
Full final-commit CI and combined release qualification remain required. PR461
stays Draft and Production stays NO-GO.
