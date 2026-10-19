# A new owner's manual Canva website and real customer booking

On October 19, 2026, an existing synthetic Development account with no business in
the isolated Preview database completed the normal **Your Canva Design** flow.
The owner uploaded an image, placed a booking area, entered business information,
reviewed services and booking settings, resumed the shared draft, approved the
exact changes and published. A **signed-out customer** then used the image's
booking area and completed Luster's original booking flow.

**Viewable test page:** https://luster-ai-builder-test.vercel.app/paper-nail-studio/book/service?publishedWebsite=1

This is a manual Canva acceptance test, **not a new AI design-generation or visual
fidelity demonstration**. The upload is the existing, explicitly labelled
[1200 × 480 synthetic geometry fixture](../hosted-native-photo-checkpoint/uploaded-wide-fixture.png).
No generated HTML/CSS or direct database edits were substituted for owner actions.
The original business setup and website were entered through the application.

## What actually happened

1. The owner chose Your Canva Design, uploaded the wide image through the file
   chooser, supplied an accessible description and added a raised booking area.
   The app preserved its proportions and warned that small text in wide images
   can be difficult to read on phones. [Clickable-area screen](booking-area.png).
2. The owner entered Paper Nail Studio, Toronto, home-based, one artist, weekday
   hours, a private synthetic service address, city-only public visibility and
   synthetic contact details. Five unwanted starter services and four add-ons
   were explicitly removed through onboarding; the five service records remain
   inactive. One Gel Manicure at CAD50 / 60 minutes remained active.
3. Onboarding's final action opened the shared manual website draft. The owner
   did not need to enter the same information again. [Onboarding review](onboarding-review.png).
   The handoff created draft3 from site7940be3b-efff-47f1-8b47-e0ddc2af6e43,
   onboarding revision2.
4. The owner changed Gel Manicure to CAD55 using Details. Draft4 showed CAD55 / 60
   minutes while the canonical service still held CAD50. Clicking the private
   preview's booking area reported booking disabled. [Private mobile view](private-mobile.png)
   and [measured proportions/tap targets](private-mobile-geometry.json).
5. Before publication, a signed-out public page ended at404, a direct booking
   POST returned403 (`Salon is not accessible`), and no appointment existed. The
   other synthetic owner also received404 for the private draft.
   [Other-owner denial](other-owner-denied.png). These are observed HTTP/UI results,
   not a claim that every authorization or concurrency scenario was exercised.
6. The owner checked the original artwork and saved its review as draft5,
   artifact da9c0313-939c-4a19-86e4-f77f057d549a. Refresh resumed the same saved
   draft. The review displayed CAD50→55, 60 minutes, address visibility, named
   website settings and exact contact identifiers. [Before the review-copy fix](review-before.png)
   and [after](review-after.png).
7. The owner approved and published revision5 once. SQL verified one finalized
   publication, approval for revision5 and the same canonical service identity.
   Publication changed the active price to5500 cents without adding services or
   staff. The private service address remains saved in the owner draft, while the
   public address is null and public visibility is city-only. [Published owner](published-owner.png).
8. The public page used the same renderer and preserved the image. Instagram,
   email and phone were real `https:`, `mailto:` and `tel:` links with the expected
   targets; no call, email or Instagram message was sent. [Desktop](published-desktop.png),
   [mobile](published-mobile.png).
9. The owner signed out through the normal Log out controls. The customer clicked
   the image's booking area, selected the canonical Gel Manicure, saw Maya Test,
   CAD55 / 60 minutes, the two-hour notice and ten-minute buffer, then selected
   October20 at10:00AM EDT. The signed-out availability screen had no owner-preview
   banner. Synthetic customer details were used, appointment texts were unchecked,
   promotions stayed off, and no deposit was required. [Customer review](customer-review.png).
10. The original confirmation page showed **Appointment confirmed**. SQL verified
    one new confirmed appointment at14:00UTC, 5500 cents, 60 minutes, Maya's actual
    technician ID, the original service ID and a70-minute blocked duration.
    A fresh availability page dropped from28 to23 times, with11:15AM the first
    available time. [Confirmed appointment](customer-confirmed.png),
    [updated availability](availability-after.png), [safe SQL proof](proof.json).

## Isolation, implementation and limits

The application was READY Preview deployment dpl_9NQLc8YZQr56fVv9BSCYxfHsecrR,
commit260f7f664550e676991dd80ac1705fd2afd99895. Its exact Git SHA, project and alias
were verified. Renderer deployment dpl_F8x1J2QXjiNutnbi6TfD98vfVS5y remains on
0e65facb9d4d222f5cd97044852f28014f9220c0. No Production configuration, data,
migration, merge or deployment was changed.

Read-only Preview comparisons verified every prior row in the salon, service,
technician, appointment and custom-site-asset baselines was unchanged, including
all31 previous synthetic appointments. See [preservation counts](preservation.json).
SMS remained operator-disabled. Both attempted email deliveries failed with
`RESEND_NOT_CONFIGURED`; no provider accepted a message. This does **not** qualify
email delivery, SMS or payments.

This entire manual journey made **zero AI calls**. The global call count remained180;
tracked real-AI trial usage stayed CAD36.037946 under the unchanged stricter
CAD68.615594 operator cap. Those earlier amounts are application receipt estimates,
not a provider invoice or a new spending commitment.

The walkthrough led to two source corrections: bb90efe9 prevents CAD-prefixed
asset UUIDs/colours from being mistaken for copied prices while enforcing visible
and accessible price bindings; 260f7f66 names review changes, preserves underscores
in owner wording, links Canva blockers to Preview and avoids calling unpublished
bookings live. Local validation passed105 domain/PGlite tests,47 owner UI tests,
19 prototype tests, scoped types, changed-file lint and secret checks.

**First-load failure remains material.** A new private tab and a signed-out public
load sometimes stayed at about:blank. [Private failure](private-first-load-stall.png),
[public failure](public-first-load-stall.png). The visible Reload control recovered
both without a model call or draft change; [recovered public page](public-recovered.png).
These failures were retained rather than presenting a clean first attempt.
Follow-up source2026f8e5 creates each opaque frame on the client with a separate
session for every saved document. Its13 bridge/hydration tests, types and lint pass;
its hosted first-load acceptance is separate from the earlier journey above.

The CI attempt on d21b5f02 exposed the price-validator defect and a separate
Storybook/installed-Webpack compatibility failure. It was automatically superseded
after the next source push; completed failure logs were retained privately.
No overall green CI, physical-phone qualification or completed builder release
is claimed. PR461 stays Draft and Production remains NO-GO pending all required
runtime, security, payment, dependency and browser gates. The initial account's
empty dashboard also needed the normal onboarding route; this is not fresh-signup
acceptance. Contact-link targets were verified; external destination availability
and message delivery were not.

All15 screenshots are unchanged captures. [Screenshot hashes](screenshots.json).
