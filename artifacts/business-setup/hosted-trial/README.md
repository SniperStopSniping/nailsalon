# Hosted AI website pilot — verified checkpoint

Test entry: https://luster-ai-builder-test.vercel.app/ai-website-test

Deployed application commit: `6343c7b0d288c04023499000ddf4e31e58fb7c5d`.
Vercel Preview deployment: `dpl_6iWyoSi4G5ZvoJWcMJm9jz7GCVE6`.
The application remains Vercel-protected and uses Development Clerk authentication
and a dedicated Preview database. Production was not merged, migrated or deployed.
The separate renderer has no database/provider credentials, no outbound network,
and runs visual interactions in a constrained worker. SMS, payments and external
customer integrations are disabled for this trial.

## Try the two owner journeys

Sign into Vercel if prompted, then sign into the test application and choose
**Open my AI website test**. This creates an empty private test business for your
verified identity; it does not copy or modify an existing salon.

1. Give Luster the business name, location, hours, services, prices and durations.
   Check the saved values in **Business setup**. They are reused for every design.
2. In **Website**, upload inspiration (PNG/JPG/WebP/PDF, up to 3 MB each), select it,
   explain what to preserve or improve, then generate. Mark owned photographs/logos
   as website assets; reference artwork is inspiration only.
3. For the text-only test, unselect the inspiration, choose **Start over with an
   entirely new design**, and describe the new site. Optional owned photos may stay
   selected. Earlier designs remain available under **Previous designs**.
4. Revise through chat, inspect desktop/mobile, review service prices/times, and
   approve the exact draft before publishing. Publication affects this test
   environment only. Use synthetic customer details for test bookings.

## Actual model generation — no authored output substitutes

Provider/model: OpenAI Responses API, `gpt-6-astra`. The hosted owner UI performed
business intake, image upload, reference generation, text-only generation and a
follow-up mobile edit. All three design responses passed their first validation;
no manual source repair or replacement occurred. The exact first outputs remain
in private database evidence, with hashes/retained lengths in `usage.json`.

| Request | Saved draft | Artifact | UI generation time |
| --- | --- | --- | --- |
| Cream editorial screenshot + owned photos | 3 | `006bf81e-7d15-4524-943b-0880dc59d3da` | 78.123 s |
| Original dark fashion brief + photos, start over | 4 | `b0d3194b-cbb9-45d3-ac9a-8602ec98e28c` | 86.205 s |
| Mobile refinement through the main owner chat | 5 | `f0bb4cde-6589-4385-af21-4277d6db1e3b` | 75.616 s |

The inspiration is `../custom-frontends/desktop-editorial-custom-site.png`.
It is a hand-authored fixture used ONLY as input. Files07 show the model's cream
result,08 the original dark design, and10 its chat revision. The two outputs have
different layout/source, not just different colours. Both use live-data bindings.

Visual assessment: cream output preserves cream/green colours, serif/italic
hierarchy, asymmetry and overlapping images. It changes the photographs, text and
service composition, so it is not a pixel-perfect recreation. Dark output uses a
centered masthead and full-width photographic hero. The mobile chat edit makes
its heading smaller, adds comfortable side padding and raises the booking CTA;
the large close-cropped photograph remains a subjective design choice. Overflow
checks passed at1280 and390 px. No claim of five-style or real Canva-export
acceptance is made. No comparative provider trial has yet been run.

## Publication and original booking

Fresh mobile browser context resumed the same saved business/design. The owner UI
restored the earlier design then the latest design without regeneration. Before
publication, the anonymous public site and private draft preview both returned404.
The owner accepted prices/times, reviewed exact changes and published revision8:
receipt `1200071c-da12-4f12-ba92-29830de11026`.

Two distinct synthetic bookings then completed through the original Luster UI:
custom service card → canonical service selection → eligible technician → real
availability → customer/policy review → appointment confirmation. Both are CAD65
and75minutes; IDs, service IDs, technician and timestamps are in`booking-evidence.json`.
The second test consumed the next available slot and preserved the first booking.
No email/SMS/payment was sent. The private street address was absent from the
public custom frontend. The confirmation screenshot explicitly shows texts off.

Files11–18 show resume, restoration, business review, exact approval, isolated
publication, original booking review and confirmation. `index.html` is a local
screenshot gallery; it is evidence, not a generated website or deployed product.

Local evidence in`../real-provider/` additionally covers all five requested chat
edits, manual text editing, deliberately lost publish response/idempotent recovery,
and a later approved price update that changed live bindings while preserving the
existing appointment's historical price/duration.

## Cost and boundaries

14 real calls total:10 local plus4 hosted (including business intake).
Provider usage cost: USD4.318636 total, of which USD1.126433 hosted.
Conservative ledger accounting uses2 CAD/USD: CAD8.637272 charged overall.
This is a cap-accounting estimate, not a currency-converted invoice. The local
ledger is frozen at CAD6.384406; the shared hosted cap is CAD33.61, leaving
CAD31.357134 hosted allowance. Combined maximum remains below the authorized CAD40.
Every request reserves its upper bound before dispatch. Pending/unknown usage is
not silently refunded. The user’s own tests share this allowance.

## Interventions and limits

- Fixed missing email-verification UI and Next server-action navigation failure.
  Verified the replacement authenticated POST/full-navigation entry on6343.
- An initial screenshot opened the old revision before React updated; reload of
  saved state corrected the capture without another model call or source edit.
- The first publish test checked controls before asynchronous setup loaded;
  publication correctly refused unreviewed services. Waiting for the saved data,
  then explicitly accepting the displayed prices/times, enabled publication.
- The first confirmation screenshot caught the existing animation mid-fade.
  A second distinct synthetic booking captured the completed confirmation.
- Full Vitest CI shards and both Next builds passed on6343. The application job
  found one quote-style lint error in next.config.mjs, corrected in the evidence
  follow-up without changing the CSP value. An SMS-ledger job was blocked before
  tests by an ECR Docker image download quota. Remaining CI status stays in PR455.
- This is a testable pilot, not the full essential-release sign-off. Menu extraction,
  full staff/policy editing, appointment-impact review, real Canva/five-style tests,
  broader accessibility and an independent runtime review remain incomplete.
