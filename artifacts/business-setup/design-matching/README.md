# Owner photos and reference matching

This checkpoint adds a saved choice between closely matching a reference and using it as inspiration, explicit owner reference attribution, and a separate photo/logo library. Assets remain tenant-scoped; these controls update the shared setup draft. Replace/remove creates a new immutable design version without a model call. Restoring a design restores its relevant image selection. Generation receives the saved choices and only selected website assets, so removed images are not silently reintroduced from an older design.

Local verification: 82 automated tests passed across draft integration, API authorization/routing, UI, custom-source validation, payloads and isolated frame behavior. ESLint and TypeScript passed. A real browser uploaded an inspiration image, two photos and a logo, selected close matching, refreshed, and resumed in a separate mobile browser context. Browser testing exposed and fixed hidden file inputs causing horizontal mobile overflow. Synthetic local test photos were explicitly uploaded Isla fixtures; they were not an automatic fallback. No provider calls occurred in this local check.

The existing custom renderer and original booking integration remain authoritative. This is editable source reconstruction, not a pixel-perfect Canva import or screenshot overlay. Separate original photos/logo improve fidelity; current font and safe interaction restrictions remain. Existing custom-site uploads are reusable in the library. Importing an older salon portfolio, extracting individual photo layers from flattened artwork, and automatic visual similarity scoring are not implemented in this change.

## Real owner workflow verified

Deployed application: `3c53491f2e414effa736e268d3e8829913beb9e0`, Preview `dpl_4mf2Z2q3ZAhbXngEaQcPTJC6c2k8`. The follow-up preserves generation/rendering/publication behavior, improves the owner review copy to show design choices and image counts instead of internal IDs, and fixes tests/the isolated fixture migration gate. Final deployment metadata is recorded in deployment.json.

Builder: https://luster-ai-builder-test.vercel.app/ai-website-test

New generated site: https://luster-ai-builder-test.vercel.app/ai-onboarding-082c9d52379e/book/service

The actual owner interface uploaded an owned editorial screenshot and two explicitly selected Isla photo fixtures into the fictional Aster salon. The reference is a pre-existing hand-authored input fixture, **not substituted generated output**. There was no manual source repair. The published source is the exact Astra chat result, restored through the owner history after testing manual photo controls.

1. Existing business details from the earlier menu extraction were reused without re-entry: Aster Nail Studio, Toronto, solo/home, private address, Tue–Sat10–18, BIAB65/75 and gel50/60.
2. Selected **Match my design closely**, confirmed reference ownership, and uploaded two photos using **Your photos & logo**. Initial request: “Make this my booking website. Match the uploaded layout closely, use my saved business details, and include the two photos I chose.”
3. Astra generated artifact `a492cb15-6eb9-4180-9982-0d423c444ce1`, revision10 in64.912seconds. First output passed validation without repair:8,275 input/3,427 output tokens, estimatedUSD0.274780.
4. Owner chat: “Keep this design, but make the photos larger and overlap them. Make the mobile version less crowded.” Result `08167c8d-5e28-402f-b407-97ba116fac8e`, revision11 in62.646seconds,11,435 input/3,892 output tokens, estimatedUSD0.337530. First output passed validation. Services, prices, durations, hours and booking configuration stayed identical.
5. Owner controls replaced a photo, removed it, refreshed and restored the exact chat-generated source as revision14. No model call. Original source and image selection were restored; business details were unchanged.
6. The original exact-review screenshot exposed internal reference IDs. A final UI-only fix replaces them with friendly matching/photo counts; local-readable-review.png verifies the fix. The owner accepted the service prices/times, reviewed and published revision15. Receipt `39ddce90-4d95-44b0-99de-00920be87d25`. Anonymous customer then selected the generated BIAB button and completed the **original Luster** service/staff/availability/confirmation flow. One actual synthetic appointment exists atCAD65/75minutes. Exactly two live services and one publication were created in this test salon.
7. Public desktop1440/mobile390 checks verify selected images load, photo rectangles actually overlap, no horizontal overflow, and the studio-note interaction reveals live hours. Private preview booking is blocked; publication uses the original booking integration.

[View screenshots and reference comparison](index.html). Metadata and the first/final generated sources are retained alongside this report; provider first outputs remain in the private ledger. No raw private upload, credential or customer token was added to logs.

## Visual evaluation and limits

The first generated result closely follows the reference’s slim header, cream/green palette, serif/italic hierarchy, two-column proportions, rotated artwork, ochre divider, service rows and expandable studio note. It is materially closer than merely picking a preset. The italic headline is slightly wider and heavier, curve contours differ, and supplied photos plus two current services lengthen the lower section. Mobile adapts the desktop reference; no separate mobile reference was supplied. After the requested edit, larger overlapping photos and less dense mobile service rows are visible. Original image content has not been invented.

Exact fonts are not imported. This verifies one close-match reference and an iterative edit in the new mode, not universal pixel-perfect Canva conversion or five-style professional-quality acceptance. The earlier pink/black sample, its settings hash and all three existing appointments remain unchanged.

Two browser automation attempts stopped before paid generation: an asynchronous checkbox required a click-and-wait, and resume required expanding the collapsed design section. A later image-loading assertion ran before lazy images loaded and was corrected to scroll and await them. These were test-driver corrections; no generated source was changed behind the scenes.

New model usage totalsUSD0.612310, counted asCAD1.224620 using the conservative trial allowance. Combined local/hosted charged or reserved usage isCAD14.772002 ofCAD40. This includes the previous unknown-charge timeout reserve; it is not a reconciled invoice.

Branch-specific environment inspection confirms Preview, SMS disabled, and no Twilio, Stripe, customer-email or Calendar credentials. Database host/marker were independently checked. No production deployment/migration, outbound message, payment, or production data change occurred. No new migration was needed for these design choices.

CI exposed two missed test-format blank lines and a Preview fixture guard still pinned to103 migrations after the already-added0104 status constraint. Follow-up fixes the formatting and pins the guard to exactly104; hash/count checks and FK protections remain intact. Three independent PostgreSQL CI jobs failed before tests because Docker Hub returned `toomanyrequests: Data limit exceeded`. The 39 fixture tests and 6 UI tests pass after these fixes; scoped ESLint and TypeScript pass. Mobile review was checked in a real local browser. Full CI is therefore not green at this checkpoint; no merge gate is bypassed.

Remaining whole-feature work still includes staff/policy completeness, broader Canva/style/accessibility coverage and independent runtime review. This is a working photo/matching checkpoint, not a claim that the complete release is finished.
