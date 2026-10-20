# Hosted owner-to-booking checkpoint

## Environment and source

This checkpoint ran through the actual owner-facing application at
https://luster-ai-builder-test.vercel.app, backed by the dedicated Preview
PostgreSQL database and separate https://luster-ai-render-test.vercel.app origin.
The READY application deployment was built from `2c18ce232748cf7cdb59158442def9f9ce04f9d1`.
Its application source matches the release candidate; subsequent changes only
correct migration-fixture contracts, tests, and this evidence. The clean release
branch starts at main `8265697f041e1f6e3adc6462dabef8ba3523384c`; original development
history remains preserved. This does not claim the new release commit passed CI.

All business/customer records are synthetic. Clerk Development, real OpenAI API
responses, Stripe sandbox Checkout and the provider's actual sandbox webhook
were used. No production deployment, production database change, live payment,
SMS, email, calendar write, subscription, or credit recovery grant occurred.

## Actual owner journey

1. Native Clerk sign-in entered a private owner salon. Own draft returned200,
   another salon403, invalid-origin mutation403, and anonymous unpublished
   booking404. An uploaded pink inspiration screenshot remained after refresh.
2. The owner bought the CAD10 pack in real Stripe sandbox Checkout. Provider
   session verification and its actual delivered event confirmed one purchase
   ledger entry and one processed webhook, with livemode false.
3. The business-first chat saved Cobalt Nail Club's solo, home-based Toronto
   details, CAD services, durations, hours, two-hour notice and private-address
   preference. No business details had to be re-entered for website generation.
4. The same chat generated actual custom HTML/CSS and isolated interaction
   source from the uploaded reference. Revision4 took110.611s overall; its design
   model call took104.232s. The first result passed automated validation without
   repair. Both the first and refined source remain persisted as immutable design
   artifacts in the dedicated Preview database.
5. A follow-up asked for a complete hero redesign and less crowded mobile
   layout. Revision5 took111.406s overall and preserved business/settings fields.
   Both design calls were `gpt-6.1-sol`; the conversation model was `gpt-6-luna`.
   No hand-authored site or hidden developer source repair was substituted.
6. Chat changed BIAB65 to70 through the business-settings draft; it did not
   regenerate the frontend or change public data. A deliberate manual wording
   edit through the owner UI created revision7 while preserving CSS/JavaScript.
7. Displayed prices/times were accepted, revision8 was reviewed and approved,
   then genuinely published in Preview. A deliberately lost successful publish
   response was recovered by replaying the same operation:200, no duplicate
   services, and the exact approved source/service map.
8. A signed-out customer clicked the generated BIAB service's Book Now, used
   Luster's original service/staff/calendar/confirmation screens and created a
   real confirmed synthetic appointment: POST201, CAD70,75min, eligible artist.
   The actual customer management receipt was followed and checked separately.
9. Returning to the builder, the owner restored the earlier design and then the
   current one as new drafts. Public data, appointment and service records stayed
   unchanged; no new model call occurred; refresh resumed the saved revision.
10. Another chat changed BIAB to75. Private preview showed75 while public
    website/native booking still showed70. Exact review and approval published
    revision13. Both the custom website and original menu now show75; the prior
    appointment and its service snapshots remain70/75min. No second appointment
    was made. The actual Instagram tap opened the correct profile request, which
    the test harness blocked before contacting Instagram.

## Cost, visuals, and truthful limits

Seven completed real model calls cost an estimated US$0.127490, or
CAD0.178486 at the application's versioned1.4 accounting FX. This is a
provider-token estimate, not a reconciled invoice. The owner's separate prepaid
credit debit was CAD0.356975; the UI rounded the balance to9.64. The operator's
shared CAD80 test cap was not increased or reset. Ordinary appointment booking
made zero AI calls and therefore had zero AI API cost in this journey.

The first custom draft has pink editorial framing, a script heading hierarchy,
large whitespace, bound service cards and real contact links. Desktop1440 and
mobile390 layouts had no horizontal overflow. The opaque renderer could not
read the authenticated parent document. The owner did not supply original salon
photos, so another business's photographs were not copied and no photo gallery
was generated. This proves reference-led styling and composition, not exact
photo recreation, image overlap, or a five-reference visual acceptance matrix.
The hero revision is a genuinely separate generated implementation. Gallery
reordering cannot be claimed from this fixture because it has no gallery.

The intake phrase '10 minute cleanup buffer' was interpreted as the supported
**global booking buffer** of10; individual service preparation/cleanup remained0.
Review displayed that distinction. This checkpoint does not claim a per-service
cleanup setting was inferred correctly. No full residential address was supplied.

Harness-only corrections are retained: the final native menu renders '$75',
not '$75.00'; a delayed blocked Instagram popup must not be mistaken for the
booking page; a read-only diagnostic used duration_minutes after an invalid
column name. No generated source or application data was repaired to pass these
assertions. The initial publication proof predates the successful customer
booking; the later booking proof and receipt supersede its 'not yet completed'
flag. Raw logs, capabilities, credentials, uploaded source image and auth state
remain private outside Git.

## Evidence and remaining gates

- [Model prompts, revisions, times and usage](model-steps.json)
- [Provider accounting and other-tenant preservation](accounting-proof.json)
- [Sandbox purchase](sandbox-checkout-proof.json) and
  [actual provider webhook](provider-webhook-proof.json)
- [Authorization](authorization-proof.json), [renderer](first-render-proof.json),
  [revision preservation](refinement-preservation-proof.json),
  [manual edit](manual-edit-proof.json), [restore/resume](restoration-proof.json)
- [Exact publication/replay](publication-recovery-proof.json),
  [original booking](original-booking-proof.json),
  [later approved price and old appointment](later-price-proof.json)
- [Desktop draft](hosted-initial-desktop-top.png),
  [mobile draft](hosted-initial-mobile-top.png),
  [review](hosted-exact-review.png),
  [successful publication](hosted-publication-recovered.png),
  [original customer receipt](hosted-customer-receipt.png),
  [updated original menu](hosted-original-menu-updated-price.png)

The36 existing isolated Preview environment records were transferred by branch
metadata only to `codex/ai-website-release-20261019`. Their values were not read,
rewritten or printed. Other records/targets remained unchanged. See the
[scope proof](preview-branch-transfer-proof.json).

This checkpoint supplements prior local/disposable-PostgreSQL unit, integration,
concurrency and native browser evidence; it does not relabel that evidence as
hosted or newly rerun. The new clean release PR still needs its own complete CI,
review and Preview-source verification. Fresh-device hosted mobile acceptance,
additional visual-reference styles, and an isolated hosted manual-Canva media
claim/transfer remain outstanding. Production payment/model/storage configuration
and the protected-main release checks are separate, uncompleted gates.
