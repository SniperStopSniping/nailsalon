# Real recommendation to original booking

This actual owner-facing journey ran at https://luster-ai-builder-test.vercel.app
on application source `eb7327ce3913400195d9ff210690a60b8bd9dbde`. All business and
customer records are synthetic and isolated from production. No live payment,
message, calendar integration or production configuration was activated.

## Conversation and private draft

From the published dark custom website, the owner opened a new draft25 and asked
for an express natural-nail manicure: shaping, cuticle care and regular polish,
without extensions/removal. The request specified illustrative affordable CAD
pricing and duration for the saved solo Toronto business, with existing services,
hours, booking rules and design preserved. No business details were re-entered.

One real `gpt-6-luna` call proposed35CAD and45minutes in revision26. The reply
explicitly called these illustrative recommendations for owner review. The saved
service was unconfirmed, with owner-supplied name and suggested price/duration
provenance. The source artifact stayed unchanged; there was no design regeneration.
[Exact prompt, usage, time and revision](model-step.json).

[Draft checks](hosted-recommendation-proof.json) confirmed the original services,
prices, times, settings, website and staff details remained intact. The solo owner
automatically received draft eligibility for the new service; all previous assignments
were retained. This necessary new eligibility is disclosed, not described as an
unchanged entire staff array. The private renderer showed three bound cards, including
the proposed35CAD/45min service, while the live database still contained two services.
[Preview proof](hosted-recommendation-preview-proof.json).

The real Review button prevented publication until prices/times were confirmed.
After the owner accepted them, revision27 also required the existing-appointments
acknowledgment because the staff member's service choices expanded. The harness
initially missed this required checkbox and stopped safely; it did not bypass the
approval guard or submit publication. The owner then acknowledged the displayed
notice that the two existing appointments would stay booked. The first blocked review
and final checked review are retained separately.

## Exact publication and real appointment

The owner approved and published the exact revision27. Its receipt maps temporary
`draft_express_natural_manicure` to one canonical service record, with35CAD/45min and
an enabled assignment to the existing owner. The total became three services, with
no duplicated name or changed original service records. Both earlier appointments
were byte-for-byte unchanged. Publication made zero model calls.
[Publication proof](hosted-recommendation-publication-proof.json).

A signed-out mobile WebKit customer then selected that generated service card.
Its Book Now used the mapped canonical identity and opened Luster's original
service/artist/calendar/confirmation flow. The real availability request returned200;
the original appointment endpoint returned201. The confirmed appointment records
35CAD/45min, the correct eligible owner and matching historical service snapshot.
The earlier70CAD/75min and75CAD/75min appointments stayed unchanged. No mock booking,
separate scheduling engine or AI call was used for the booking.
[Original booking proof](hosted-recommendation-booking-proof.json).

After refreshing and selecting Make more changes, the builder created draft28 from
the current live service identity and approved35CAD/45min values, with confirmation
retained and no new AI call. [Return-visit proof](hosted-recommendation-return-proof.json).

The returned customer management receipt was followed and checked separately, after
the confirmation screen settled. Its capability URL, raw response and customer
details remain private outside Git. A helper-generation assertion failed before any
booking request while preparing this check; correcting that test helper did not alter
application code or generated source. The successful appointment was submitted once.

## Cost and scope

This recommendation cost an estimated US$0.000899 / CAD0.0012586 at configured
accounting FX1.4. The cumulative hosted trial now has18 completed real calls,
estimated US$0.381841 / CAD0.5345774, with no held requests. These estimates use actual
provider token usage and versioned rates; they are not invoice reconciliation or
verified local-market pricing. Other tenants' fingerprints remain unchanged, and the
shared CAD80 test cap was not raised or reset. Owner prepaid credits use a separate
ledger. [Accounting proof](hosted-accounting-proof.json).

- [Unconfirmed review](hosted-recommendation-unconfirmed-review.png)
- [Proposed service in private mobile preview](hosted-recommendation-private-mobile.png)
- [Appointment acknowledgment required](hosted-recommendation-blocked-review.png)
- [Exact final review](hosted-recommendation-exact-review.png)
- [Successful isolated publication](hosted-recommendation-published.png)
- [Settled original-booking receipt](hosted-recommendation-customer-receipt.png)

This verifies a return visit using saved business data and an existing custom design;
it is not a separate claim that a blank new-owner journey, five-reference visual
acceptance matrix, full accessibility or final combined dependency CI has passed.
Those remain release gates. Production remains unchanged.
