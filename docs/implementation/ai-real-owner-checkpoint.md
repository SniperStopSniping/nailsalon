# Real owner workflow: paid AI generation and original booking

This checkpoint ran the actual owner application against the task-owned loopback Development database. It did not deploy, merge, purchase infrastructure, change production data, or exercise a real Stripe purchase. The synthetic owner used a clearly identified CAD10 recovery grant to test the paid wallet/metering path. Stripe sandbox acceptance remains pending the owner's test key.

## What actually ran

The owner entered Petal Studio, Toronto, solo work, Tuesday–Saturday 10:00–18:00, BIAB $70/75 minutes and Gel manicure $50/60 minutes through chat. The provider saved those details before design. The owner then attached the supplied pink Dynasty screenshot as **inspiration**, with a short request to use the saved business details. This was not an ownership assertion or permission to reuse that other business's photographs or policies.

All generation and revisions went through the same message composer and upload dialog intended to ship. Source was produced by OpenAI, validated by the application and saved as immutable artifacts. No developer-authored HTML/CSS was substituted, and no generated source was manually repaired. No automatic repair was required in this trial. First responses remain privately retained in `setup_ai_call.raw_output`; published source/design history remains in `custom_site_artifact`.

| Owner action | Saved revision | Result |
| --- | --- | --- |
| Business intake | 2 | Name, city, solo work, hours and both services captured together |
| Attach inspiration | 3 | Saved through the real upload dialog |
| Create website | 4 | Custom source `6a14805b-0c6a-4972-862e-a2043c7d8407`; Sol generation took 118.997 seconds |
| Completely redesign the hero | 5 | New model-generated source; business configuration preserved |
| Put services above the gallery | 6 | New model-generated source; business configuration preserved |
| Attach two synthetic test images | 7 | Reused committed landscape/portrait test fixtures; no model call |
| Make images larger and overlap them | 8 | Luna revised the source using the selected images |
| Make mobile less crowded | 9 | Luna revised the saved design; desktop/mobile captures retained |
| Keep the design, change BIAB to $65 | 10 | Existing service draft identity updated to 6500 cents/75 minutes; design identity unchanged |
| Restore first design, then latest design | 11, 12 | Restored through Previous designs; retained the $65 business draft |
| Accept displayed services, exact Review, approve and publish | 13 | Canonical services/staff assignments created through the normal publisher |
| Customer selects BIAB on generated site | Published 13 | Original service/time/confirmation flow returned HTTP 201 and a persisted appointment |

Before publication, the salon was still `draft`, online booking was false, and it had zero live services. The anonymous public booking page returned 404. Read-only comparisons confirmed that visual revisions 4, 5, 6, 8 and 9 preserved business, services, hours, booking settings, staff and agreement configuration. Private desktop/mobile frames could not read parent or own cookies and had no horizontal overflow.

Published BIAB has canonical service identity `d8508381-0392-488a-bf8a-e1cc4fbfbf49`, price 6500 and duration 75. Gel manicure is 5000/60. The generated card invoked the real booking integration with the BIAB identity. Two independent synthetic browser bookings were completed; each was a separate intentional customer submission, not a publish retry. Their saved price/duration are $65/75 minutes, with the original 10-minute booking buffer producing 85 blocked minutes. The first confirmation capture caught an entrance-animation frame; the second run waited for the settled receipt.

## Evidence and limitations

- Initial input, result and metered call IDs: `artifacts/ai-credits/real-owner-petal/`.
- Per-action screenshots, videos, revisions, artifact hashes, provider/model, usage and validation: `artifacts/ai-credits/real-provider/paid-ai-petal-41bb1f28/`.
- Exact owner review and publication: `2026-10-17T23-16-46-552Z-publish/` beneath that folder.
- Readable original customer booking/receipt: `2026-10-17T23-19-08-082Z-book/`.
- Repeatable, explicitly billable opt-in runner: `scripts/real-ai-builder-trial.mjs`. It uses browser controls for uploads, conversation, restoration, approval, publishing and appointment creation. SQL reads only observe evidence. It cannot author/repair designs or increase the trial allowance. It is excluded from default CI.

The visual result is a pink, framed composition with serif hierarchy, custom geometric decoration and an original split hero after revision. It is an interpretation of inspiration, not an exact Dynasty recreation. Reference photography, branding, contact details and policies were not copied. The two selected image fixtures are plain synthetic test artwork, not professional salon photography; the overlap test proves editable image arrangement, not photographic fidelity. System fonts approximate the reference. Two additional materially different real-generation cases, text-only generation, owned Canva/PDF fidelity, meaningful manual design editing, and broader reference-quality assessment remain required.

Several early runner attempts failed on test observation, not generation: a scope selector is absent for first-time owners; the full-preview route is `design-preview`; Preview toggles closed if clicked while already open; a fresh local confirmation route took over five seconds to compile. The retained manifests show those failures. The runner was corrected to follow visible controls, await the displayed revision and route, and capture fully initialized frames. A failed screenshot attempt did not trigger another paid generation. Legacy synthetic owner authentication worked; Clerk's deliberately blocked test-script request is retained in browser-error evidence. This does not verify real Clerk signup or cross-device authentication.

## Usage and budget

Twelve real OpenAI calls completed, using `gpt-6-luna` for intake/narrow edits and `gpt-6.1-sol` for initial design/major edits. Provider-usage-based Standard-rate estimate: **USD0.253381**. Trial accounting charged **CAD0.506762** using its deliberately conservative 2-CAD-per-USD allowance; this is not a live FX rate or invoice. The synthetic retail wallet charged **CAD0.709474** using the separately frozen retail conversion. All seven owner-request credit reservations settled.

The original aggregate CAD80 ceiling remains unchanged. Before local trials, CAD5 was transferred from the isolated hosted allowance to local, reducing hosted first under lock before increasing local. Current caps are local CAD11.384406 plus hosted CAD68.615594. Reconciled charged/retained amounts are local CAD6.891168 plus hosted CAD33.877748, total CAD40.768916. The hosted unknown-usage reservation remains retained. No ledger was reset and no fresh per-salon trial allowance was created.

## Application changes and checks

- First-draft copy distinguishes actual preview defaults from complete owner-provided chat details, while keeping service review mandatory.
- Bounded service-order and mobile-spacing edits now route to Luna. Explicit redesign/layout/animation requests still use Sol. Real Luna image and mobile revisions completed without source repair; this is not a controlled claim that Luna matches Sol's initial-design quality.
- 123 draft integration cases passed, including the new saved-details wording/review regression. Thirteen routing, 25 custom-source validation and 21 owner-request metering cases passed. Provider doubles in those tests are separate from the real calls above.
- Type generation and TypeScript passed with the documented isolated Development environment; scoped ESLint and whitespace checks passed.
- The working-tree secret scan stopped on four oversized unoptimized Development client chunks exceeding its 5-MB per-text-file bound. It did not identify a credential leak. This is an incomplete generated-client scan, not a passing release gate. Optimized build/CI secret verification remains required before release.

The full paid builder remains unfinished. Continue real Stripe checkout/webhook acceptance after secure test-key configuration; additional visual/text/Canva trials; supported add-ons and deposit/reminder prerequisites; onboarding recording/friendly entry URL; real account/cross-device journeys; hosted Preview isolation, held push/PR updates, required CI/review and production release verification. No production readiness or deployment is claimed by this checkpoint.
