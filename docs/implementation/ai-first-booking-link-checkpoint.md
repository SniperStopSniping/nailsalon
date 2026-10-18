# AI setup: first booking link and publication recovery

## Owner outcome

An owner of an unpublished salon can choose a readable booking-link name in
Details. A suggestion uses the business name, without a model call. Saving
changes the shared setup draft only. Review displays the proposed address and
its before/after change. Exact owner approval publishes that name together
with the reviewed canonical services, hours, staff and website configuration.

Published/locked salon addresses cannot be changed here, including by restoring
an old draft. Existing manual onboarding paths retain their URL namespace and
validation. There is no separate booking engine, domain purchase or subdomain
provisioning in this change.

## Implementation and boundaries

- `tenantSlug.ts::suggestSalonSlug` shares the original onboarding suggestion
  logic, including reserved-name validation and accent normalization. A
  truncated suggestion cannot end in a hyphen.
- `site_url` is owner-only. The model/upload command path cannot choose an
  address. `SetupDocument.siteSlug` is optional for immutable legacy JSON;
  reads hydrate its current address without rewriting historical rows.
- `booking-link.server.ts` applies the existing global unique salon-slug
  namespace, including inactive salons. Review checks availability; publication
  checks again under the existing transaction. The unique constraint arbitrates
  concurrent claims. The loser rolls back services, settings and receipt, then
  gets a plain-language message to choose another address.
- Publication updates the slug, canonical configuration, receipt and existing
  `salon_audit_log` slug-change record in one database transaction. The existing
  authenticated former-slug resolver recovers requests through the old private
  address. A historical address does not confer membership or ownership.
- Server responses return the current authorized salon slug. The editor uses
  it for subsequent requests, preview, More links and the published website.
  A lost successful publish response triggers a read of the saved exact
  revision; it does not issue another approval or publication. An unavailable
  recovery read does not claim success.
- No database migration is required. Adding the optional draft field changes
  the review hash when an older draft is read, requiring fresh exact approval.

## Defect found through the real owner workflow

The first real generation completed, but the raw draft/live isolation assertion
failed. `projectSetupWebsite` spread resolved website defaults into both stored
sides. A salon with no saved live fields gained explicit default live JSON as a
side effect of attaching a reference/saving its draft. Its name, services,
hours and public accessibility did not change, but this violated the stricter
raw live-field boundary.

The projection now preserves the raw existing website objects and writes only
draft fields and draft recipe provenance. Tests cover absent live fields and
explicit saved live fields, including preset provenance. The first generated
source is retained, with its failed acceptance result. It was not manually
repaired or represented as an uninterrupted pass.

## Verification

Focused automated coverage: 280 distinct checks, comprising setup persistence
123, booking-link integration 11, owner UI 31, link controls 3, salon-scope auth
9, tenant slugs 30, original onboarding persistence 50, disposable PostgreSQL
publication concurrency 12, and deposit/reminder integration 11.

The concurrency lane uses the repository's attested disposable loopback
PostgreSQL database. Other persistence tests use migrated in-memory PGlite.
No production-impacting tests or outbound communications/payment calls occur.

Real-provider/browser acceptance is recorded separately below. Synthetic wallet
funding is not a Stripe purchase; the Stripe sandbox key remains deferred.
Real signup, checkout/webhooks, optimized-build secret scanning, hosted Preview
isolation, remote CI/review and gated production release remain outstanding.

## Actual owner workflow

Evidence: [metadata and retained failures](../../artifacts/ai-credits/booking-link/evidence.json).
The screenshots below are actual browser output, not hand-authored designs.
Full recordings/intermediate results remain privately under
`/tmp/luster-ai-booking-link-2026-10-18` with restricted directory permissions.
Model first/final source remains in the isolated database.

1. The first cold navigation timed out before any provider call: zero usage.
   A subsequent real generation completed, then failed the raw live-field
   assertion described above. That attempt is retained, not counted as a pass.
2. After the shared projection fix, a **fresh** synthetic owner uploaded the
   supplied burgundy screenshot and described Merlot Nail Atelier, Toronto,
   solo working, Tuesday–Saturday 10:00–18:00, BIAB CAD65/75 minutes and Gel-X
   CAD85/90 minutes. `gpt-6-luna` handled intake (5,732 ms), and
   `gpt-6.1-sol` generated the actual custom source (85,777 ms), validation
   passed. Revision **4**, artifact
   `c8ebaa3e-87d9-478a-b6f9-98c9b53efb7d`.
3. The owner used Details to choose **merlot-nail-atelier-test**, revision **5**.
   Live fields stayed unchanged, and the proposed anonymous booking URL
   returned 404. Review showed the proposed URL.
4. Ordinary chat: “The small writing is hard to read on my phone. Make the
   labels and body text easier to read, keeping the same design, services,
   prices and hours.” Real intake and source generation produced revision
   **6**, artifact `fba0a6d4-d886-40b7-b6f7-034defb65334` (source generation
   70,621 ms). The mobile text became readable while the composition, pending
   link, hours and service menu were preserved. No developer source repair.
5. Owner accepted the displayed service prices/times and approved exact
   revision **7**. The harness forwarded the real publish request, waited for
   its successful commit, then deliberately dropped the response. The owner
   UI recovered automatically via its saved-state read. Refresh through the
   old private-address bookmark also recovered the published state and
   correct new public link. Exactly one receipt for revision 7.
6. Anonymous **WebKit at phone width** selected the generated site's canonically
   bound BIAB card, used the original calendar and customer form, and received
   actual HTTP **201**. One submission, one appointment:
   `appt_d6696a46-ca89-4fa8-8546-63a81b5b1b7a`, **6500 cents / 75 minutes**,
   with real canonical service/staff identities. No mocked booking response,
   separate appointment form, deposit charge or outbound message.

| Evidence | View |
| --- | --- |
| Supplied inspiration | [Reference](../../artifacts/ai-credits/booking-link/inspiration.jpg) |
| Owner input and progress | [Input](../../artifacts/ai-credits/booking-link/owner-input.png), [Loading](../../artifacts/ai-credits/booking-link/generation-loading.png) |
| Actual generated site | [Desktop](../../artifacts/ai-credits/booking-link/generated-desktop.png), [Mobile](../../artifacts/ai-credits/booking-link/generated-mobile.png) |
| Readability change | [First mobile](../../artifacts/ai-credits/booking-link/first-mobile.png), [Chat revision](../../artifacts/ai-credits/booking-link/chat-revision.png) |
| Manual link and exact approval | [Link control](../../artifacts/ai-credits/booking-link/booking-link-control.png), [Exact review](../../artifacts/ai-credits/booking-link/exact-review.png) |
| Lost-response recovery | [Recovered publication](../../artifacts/ai-credits/booking-link/recovered-publication.png) |
| Original booking completion | [Confirmation](../../artifacts/ai-credits/booking-link/original-booking-completed.png) |

Visual assessment: burgundy/cream palette, serif hierarchy, oversized original
monogram, editorial frames and whitespace are consistent with the requested
direction. The mobile arrangement and menu work, and the chat revision improved
small text. This was an **inspiration** request: it does not reproduce the
reference's exact dense section proportions or photography. Reference branding
and photos were deliberately excluded, and no owner photos were supplied.
It is not evidence of exact Canva recreation or completion of all visual
acceptance styles.

Across these trials, recorded token usage at configured provider rates estimates
**USD0.181151**, including the failed isolation assertion's successful generation.
This is a rate-based estimate, not an invoice. After a fresh read-only
reconciliation, the fixed CAD80 shared test envelope remains local CAD11.384406
plus hosted CAD68.615594. Charged/retained amounts are local CAD7.491418 plus
hosted CAD33.877748, total **CAD41.369166**. Unknown-usage holds remain retained.
No allowance was reset/increased and no unrelated infrastructure was purchased.
