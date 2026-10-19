# Fifth reference: gray/pink collage and a real booking defect

This checkpoint used the actual hosted owner interface on `1f10deb7de7cdee5a7b8044b4a41b9a6b4699cda`, real OpenAI calls, an owner-uploaded reference, retained saved business settings and the existing booking system. No developer-authored frontend replaced a model response and no generated source was repaired manually. Raw first/final model outputs, editable sources and the original upload remain private.

## Owner input and generation

The already published synthetic owner chose Make more changes → Start over, uploaded the supplied gray/pink Klahs screenshot as **inspiration**, confirmed the inspiration permission and sent:

> Make my website look like this. Use my saved business details.

The reference is only137×1280px; it is not an original high-resolution Canva export. Its SHA256 and dimensions are recorded without committing the upload. Other-business branding, photographs and business details were not imported.

Input75 became generated76. The composer cleared, working feedback appeared, and a normal refresh during generation resumed the same operation without duplicate calls. The first model result passed validation and opened automatically. The draft retained all services/prices/durations, two canonical artists, assignments, hours, contacts, policy and nine existing appointments; the public website stayed unchanged before approval. Starting a new edit resolved the already-published temporary staff identity through its publication mapping to the existing canonical artist, rather than creating a duplicate.

| Request | Model | Input/output tokens | Provider duration | Estimated USD |
| --- | --- | --- | --- | --- |
| Initial orchestration | gpt-6-luna | 5933 /308 | 5.299s |0.000896 |
| Initial custom frontend | gpt-6.1-sol |2876 /6145 |96.757s |0.068639 |
| Follow-up orchestration | gpt-6-luna |6047 /214 |3.608s |0.000863 |
| Follow-up frontend | gpt-6.1-sol |8545 /6314 |76.475s |0.084501 |

Initial generation cost: **CAD0.097349 estimated**. Generation plus the following edit: **CAD0.2168586 estimated** at configured accounting FX1.4CAD/USD, using provider-reported tokens and application rates. Durations are provider stages, not end-to-end latency. This is not invoice reconciliation. Hosted synthetic-owner accounting after this checkpoint has43 completed calls totaling **CAD1.4127834 estimated provider cost**, zero held reservations, and unchanged other-salon/service/staff/appointment fingerprints. It excludes earlier local trials. The shared CAD80 operator cap was not raised or reset.

[Owner input](fifth-reference-owner-input.jpg) · [Working state](fifth-reference-working.jpg) · [Generation and edit metadata](fifth-reference-proof.json)

## Visual comparison and meaningful chat edit

The original model output has a warm gray surround, centered serif masthead, large pink dimensional lettering, white hero, torn-paper edges, black collage panel, pink contact/hour cards, original abstract nail artwork, white policy section and pale service-selection rows. Desktop uses paired visual/content panels; mobile has a stacked poster sequence. It is materially different from the other sage, floral, burgundy editorial and white/blush references.

It preserves the reference's broad palette, paper/collage rhythm, large pink headline and contact-card hierarchy. It **does not** reproduce the other business's bear, logo or nail-photo gallery. No owner photos or logo were supplied: original abstract CSS nail artwork replaces the photography, and this limitation is explicit in the builder. Bundled fonts differ from the unidentified reference typefaces. This is a custom responsive interpretation, not exact reference reconstruction, an original Canva quality benchmark, or proof of full accessibility conformance.

The first hours block was visually dense on a phone. The owner then sent through the ordinary chat:

> Keep this design. Make the opening hours easier to scan on mobile: put each day on its own line, with closed days clearly marked. Keep the actual hours, services, prices and everything else unchanged.

This created saved77 with first-pass valid model output. The worker reads structured public hours and displays seven lines at≤560px; desktop keeps its prior presentation. The result was inspected in the real renderer, rather than accepted from model analysis. All saved business settings, services and staff remained unchanged. Both first76 and revised77 sources are retained privately; separate immutable sharing versions have booking disabled.

| First generated result | After owner chat edit |
| --- | --- |
| [Desktop](fifth-reference-first-desktop-1440.jpg) · [390px hero](fifth-reference-mobile-390.jpg) | [Desktop](fifth-reference-final-desktop-1440.jpg) · [390px hero](fifth-reference-final-mobile-390.jpg) · [Readable hours](fifth-reference-final-mobile-hours-390.jpg) |

Actual Chrome measurements at320/390/768/1440CSSpx found no horizontal document overflow. Booking controls are48px tall; the visible phone menu target is45px tall. A real menu click changed its expanded state and showed navigation. Instagram/email/telephone links use trusted canonical hrefs. Private preview booking clicks remained in the booking-disabled preview. A Chrome navigation attempt stalled with a diagnostic paused-document response; that attempt is retained privately. A fresh ordinary tab loaded the revised preview and all four width checks passed without source repair or security bypass. Temporary viewport overrides were reset.

[Chat loading](fifth-reference-chat-edit-pending.jpg) · [Responsive and link evidence](fifth-responsive-proof.json)

## Exact publication, then failed booking acceptance

The deterministic review showed only the design/reference changes, with unchanged CAD/AmericaToronto/120-minute notice/10-minute buffer and complete appointment agreement. Exact77 approval produced one finalized publication receipt, `1323d346-a12c-4d53-a249-15787233066e`. Canonical service/staff/settings and the nine earlier appointments were preserved. This changed only the isolated hosted test salon.

[Exact review77](fifth-reference-review-77.jpg) · [Published77](fifth-reference-published-77.jpg) · [Publication proof](fifth-published-proof.json)

The owner used normal More → Log out → confirm; the native sign-in screen verified sign-out. A signed-out customer then used the generated Gelcard → original service selection → artist Morgan → live Wednesday12:15 availability → confirmation. Price50CAD, duration60minutes, separate10-minute buffer, saved policy and canonical service were correct. Availability returned200 and appointment creation201. However, the requested artist was **not** preserved: the POST contained Morgan's canonical ID, while the database and201 response assigned AI Test Owner. The confirmation incorrectly displayed Morgan from requested client props.

This first booking is **failed acceptance**, not a successful end-to-end result. Its synthetic appointment and original evidence are retained unchanged. All nine older appointment fingerprints remained intact. No AI call ran during publication or booking.

[Available times](fifth-original-availability.jpg) · [Incorrect original confirmation](fifth-original-incorrect-artist-confirmation.jpg) · [Recorded failure](fifth-booking-failed-artist-proof.json)

## Fix and retest status

`081b5d8358f654e323c9712d9a1d4ad581fb29ff` removes unconditional explicit-artist erasure for the legacy founding/free-solo flag. Specific artists still pass normal tenant, active/eligibility, service, location, availability and locked-transaction validation. Only null/any requests allow automatic assignment. The explicit identity also remains part of the canonical idempotency hash. No entitlement, founding flag, subscription or SMS rule changed.

Fresh confirmation now shows the committed receipt artist, with no unsupported artist claim when a receipt has no assignment. Six new assertions were red before the correction. All207 booking-write/confirmation tests passed;42 commit-effects SQL/idempotency-lock/anonymous-access tests passed, including a real in-memory database appointment/201 identity, exact same-artist replay without repeated effects, and different-artist same-key409. Scoped lint had0errors/3pre-existing FastRefresh warnings; commitlint and5162-file/one-commit secret scan passed.

The corrected pinned **branch+SHA** hosted Preview passed explicit TypeScript validation,164/164 pages, READY/full-source/project checks, runtime081b5d8 health and DB/Redis/Clerk checks. The earlier build used the full commit as its Git ref and missed the branch-specific public owner origin; it was not used for acceptance. The test alias was restored to the prior deployment while the branch-configured build completed. Preview configuration metadata was inspected without decrypting values; no environment variable was changed. Generic health remains deliberately degraded for unconfigured test integrations.

The customer started a new booking through the normal product reset, returned to the same generated77Gelcard, and used the original booking flow. Actual live calendars showed2p.m. available for **both** artists. The customer explicitly chose Morgan, disabled texts and accepted the saved synthetic policy. The POST,201 response technician,201 appointment identity, persisted appointment and confirmation all matched Morgan. Exactly one new appointment, `appt_f7ac8e03-c266-465a-9f30-c5321aa7ca4d`, is confirmed for October21 18:00–19:00UTC:50CAD/60minutes with10minutes of buffer and the canonicalGel/policy snapshots. All ten previous full appointment fingerprints, all live services, staff and business settings remained unchanged. AI-call count stayed43. The failed earlier booking remains intact and is not relabelled as successful.

[Corrected build](081b-branch-preview-build-proof.json) · [Other artist2pm](artist-fix-other-artist-two-pm.jpg) · [Morgan2pm](artist-fix-morgan-two-pm.jpg) · [Original review](artist-fix-booking-review.jpg) · [Confirmed](artist-fix-booking-confirmed.jpg) · [Database proof](artist-fix-hosted-booking-proof.json) · [Request/response/UI proof](artist-fix-network-proof.json)

## Manual edit, private/public isolation and restoration

A normal public-footer owner login used the native Development email/password UI, then More→LusterAI resumed published77. No copied auth state or testing token was used. Make more changes created78. The owner opened Edit website wording and changed only the cover note to “Your next set, your moment.” Saving created79 and updated the actual private renderer. An independent public browser retained “Your next set starts here.”

The Previous designs list exposed the earlier design's saved time and request. Restoring that entry created80 pointing to the **exact original77artifact and source hash**, rather than regenerating it. A normal refresh resumed80 and the restored copy. Live website77, all services, two artists, business settings and all eleven appointments stayed unchanged; these manual steps made zero AI calls and retained the earlier manual edit as history.

[Manual controls](fifth-manual-wording-controls.jpg) · [Saved history](fifth-manual-history.jpg) · [Resumed restored owner preview](fifth-manual-restored-resumed.jpg) · [Private edit proof](fifth-manual-edit-proof.json) · [Exact source restoration proof](fifth-manual-restored-proof.json)

The manual wording list currently exposes generated labels such as “cover note” and “nav services”; clearer owner-facing labels and preserving the visual hierarchy of multiline heading edits are useful follow-up UX checks. This plain-paragraph test does not prove every arbitrary source edit or heading transformation.

Final combined CI, broader manual Canva claim/publication/booking, original-export quality, broader staff/settings and complete accessibility acceptance remain separate gates. This checkpoint is not a declaration that the whole builder or Production release is complete. No Production merge, migration, deployment, live salon edit or outbound notification occurred.

## Final source CI status

Run39235325884 on exact081b completed with all unit/build/PostgreSQL/application, onboarding-owner and customer-booking jobs passing. Owner-operations failed at the known Storybook webpack invocation (`Cannot read properties of undefined (reading tap)`), and its two dependent aggregates failed. This is not a green release run. Independent native PostgreSQL verification in the separate release task reproduced both selected-artist and changed-artist/same-key defects before081b and passed the exact same two cases after the fix; its full combined creator lane is separate. The coherent dependency remediation and final combined gates remain with that task.

[Exact-source CI status](source-ci-status.json)
