# Fresh Stripe-funded owner checkpoint

This checkpoint proves an additional complete **local isolated** journey using a new salon whose AI balance came only from an actual Stripe sandbox Checkout. It also records application fixes discovered while exercising that journey. Nothing was pushed, merged, deployed, promoted, or written to Production. The hosted Preview and Production release remain blocked.

Application source: `edba16273fd23ad8c85fae092c1d92d49146e209`. Earlier stages used the immediately preceding saved application builds as stated below. The checkpoint commit adds evidence only.

## What the owner actually did

1. Created an owner through the ordinary Clerk Development signup UI, verified the synthetic email, and received the normal salon/organization. Started with zero credit, services, and appointments; an anonymous visitor received 404.
2. Bought the CAD10 pack through the owner credit dialog and **real Stripe sandbox Checkout**. The signed local Stripe CLI webhook granted exactly CAD10 once. No recovery grant or preloaded balance funded this account. This is a simulated card charge, not a live customer purchase or business revenue.
3. Told the assistant the business name, Toronto location/time zone, solo/home setup, private service address, Tuesday–Saturday hours, services, two-hour notice and cleanup buffer in one message. Asked for starting prices/durations. The saved editable draft contained BIAB CAD65/75min and Gel manicure CAD50/60min, still unconfirmed. The owner did not re-enter those answers on other settings pages.
4. Sent a text-only design brief through the same visible chat: cobalt/ivory, editorial type, asymmetrical panels, diagonal graphics and original nail line drawings. OpenAI generated the custom HTML/CSS/interaction source and the application validated and saved revision3. It was not a hand-authored page or preset selection. The first result remains retained.
5. Asked for more headline letter spacing, producing revision4. HTML and JavaScript remained byte-identical; CSS changed. Then asked for larger mobile booking buttons, producing revision5. During that real request, refreshed the mobile builder. Its submitted message stayed cleared, the temporary hold was labeled, and the final available balance updated without another refresh or focus event. The displayed full-preview link resolved the new revision. The bound BIAB target measured about126×58 CSS pixels in the later original-booking WebKit check.
6. Demonstrated the visible manual wording editor: changed one editable text item to “Independent nails. Your kind of colour.” This is a disclosed owner edit, not a developer repair of generated source; CSS/JavaScript were preserved. Changed the BIAB draft price to CAD70 through Details without regenerating source, and accepted the displayed prices/times. The preview showed CAD70 while canonical services/staff/appointments were still absent and anonymous booking still returned404.
7. Reviewed and approved **revision8**, including public address visibility, services, hours and booking rules. Clicked the actual Approve and publish control. The test let the server commit its200 response, then deliberately dropped that response. Refresh recovered the published state. Replayed the same persisted approval/revision/operation identity with a same-origin browser request:200; one publication receipt, two services, one eligible artist, no duplicate records, and no extra AI charge.
8. In a separate anonymous WebKit context, tapped the generated site's real bound BIAB button, selected availability in Luster's original booking flow, entered synthetic customer details and submitted the original confirmation form. The server returned201 and created exactly one appointment at **CAD70/75min** with the eligible artist. Five actual public/booking response bodies omitted the private service address before creation. A separate intentionally invalid virtual-preview-service request returned400 `INVALID_SELECTION` and created no second appointment.
9. Opened a fresh WebKit context with **no restored cookies**, signed in with the owner's password, used **More → Luster AI**, reopened the same saved salon/site, and refreshed successfully. No model call was made. Six rendered documents and82 critical text responses were readable and contained none of the four actual server-side credential values checked.

Browser automation used visible controls for signup, checkout, intake, model generation, manual edits, approval, publication and the customer booking. Read-only PostgreSQL checks established the actual saved results. The deliberate publication transport replay is disclosed separately; it did not create approval or bypass authorization.

## Screenshots

- [Business intake](business-intake.png), [editable recommendations](editable-recommendations.png), [design message](owner-design-message.png).
- First real model result: [desktop](first-ai-desktop.png), [mobile](first-ai-mobile.png).
- Real refinement recovery: [temporary hold](temporary-hold-mobile.png), [automatically settled balance](balance-updated-mobile.png), [updated mobile site](refined-mobile.png), [bound service button](mobile-service-target.png).
- Disclosed manual edits: [wording](manual-wording.png), [service price](manual-service-price.png).
- [Exact review](exact-review.png), [publication recovered](publication-recovered.png), [completed original booking](original-booking-completed.png), [fresh-device saved preview](owner-return-preview.png).

Some screens contain internal scrolling regions; the screenshots show their captured viewport, not every section at once. Private session files, raw provider responses, source revisions and recordings are retained outside Git. [Artifact lineage](artifact-lineage.json) records source-part hashes and parents, preserving the distinction between initial AI output, AI refinements, and the manual wording revision.

## Measured usage

[Full token/model/cost record](costs.json): seven completed calls across four owner turns. First custom generation used `gpt-6.1-sol`; intake, orchestration and the two targeted design edits used `gpt-6-luna`, all through the configured OpenAI provider. Do not describe every call as the cheaper model.

| Turn | Retail AI credit debit CAD |
| --- | ---: |
| Business intake/recommendations | 0.002551 |
| Initial custom frontend and orchestration | 0.193929 |
| Letter-spacing refinement | 0.013735 |
| Mobile-button refinement | 0.013878 |
| **Total** | **0.224093** |

The provider usage estimate is **USD0.080032**, approximately **CAD0.112045** at the configured1.4 conversion. This uses reported tokens and configured rates; no provider invoice was reconciled. Remaining purchased credit was CAD9.775907. A temporary CAD2 hold was a reservation, not a CAD2 charge.

The Development operator allocation remains CAD11.384406 with conservative recorded usage CAD9.896702, no pending calls, and CAD1.487704 remaining. The separate CAD68.615594 hosted allocation was neither reset nor borrowed. Their combined cap remains the authorized CAD80. Sandbox pack purchases incur no real card charge; actual model calls do consume provider usage.

## Fixes and verification

- `739e839c`: conservative regular-plural service matching for value provenance; ambiguous peer services cannot inherit owner numbers. “Prepared with AI” identifies mixed AI-prepared values; saved historical provenance and confirmation flags are preserved.
- `edba1627`: label temporarily reserved credit; bounded visible-page refresh while a hold exists; avoid overlapping/stale/other-salon balance responses; abort on cleanup. Full-preview link appears only when displayed artifact and current saved revision agree. Also generalizes the fresh-device test to the actual salon name and checks actual Stripe credentials in browser responses.
- **196 focused tests passed**:23 value-source,144 draft integration,21 credit menu,8 design studio. Scoped ESLint, full TypeScript check and diff check passed.
- **8 actual PostgreSQL concurrency tests passed,0 skipped**, on the separate attested `luster_e2e_ci_disposable` database with external providers blocked. These cover wallet holds/settlement/refunds, tenant separation, duplicate active requests and settlement failure recovery; they are not real-provider tests.
- Optimized Node24 build passed, including its typecheck and credential scan:4808 tracked/600 generated files, zero server-canary matches. Runtime fresh-device inspection separately checked real secret values, with0 leaks and0 unreadable critical text responses.
- Genuine-provider signup, sandbox checkout, business intake, model generation, local publication and original booking results are in their separate JSON proofs. Source build for signup/purchase and initial intake was `c3253898` (same application as saved `b50f4a4c`); preserved intake was rechecked on `739e839c`. First generation/spacing refinement used739. Mobile refinement, manual edits, publication, booking and fresh-device return used **edba**. This is not a claim that the complete journey was restarted on a single final build after every fix.

## Failed attempts and limits

No failed observer step was hidden or blindly repeated as a paid request:

- Signup driver tried filling a password field after signup had transitioned; resumed the same real account by ordinary password sign-in, without making a second owner or manufacturing a session.
- Initial intake exposed the service-plural provenance defect. Rechecked the accepted answers without recharging intake. Other observation assertions incorrectly expected an exact label and used an authenticated request to check public404; corrected those checks and used an anonymous context.
- First spacing refinement completed, but opening full preview raced the prior revision. Fixed the application guard and inspected the retained result without another billable refinement.
- First publication retry used a test transport without Origin; server correctly returned403. Its original captured request body was not retained. Recovery reconstructed the identical approval/revision/operation fields from the committed receipt, then performed the same-origin browser replay200. It is not falsely presented as a retained original network capture.
- Initial lint formatting failed and was corrected before the passing run.

This fresh trial is **text-only**; it does not replace the separate uploaded-reference/Canva trials or establish new visual-fidelity acceptance. No images from Isla or another tenant were used. The initial model result has a distinct cobalt/ivory editorial composition and responsive stacking with original SVG graphics; it does not prove arbitrary reference reproduction. Mobile was installed WebKit with iPhone13 emulation and native tap actions; reported `maxTouchPoints` was0, so no physical-iPhone claim is made.

No outbound customer messages, live card charges, Production data changes, new infrastructure purchases, or hosted deployments occurred. The local app, renderer, proxy and Stripe listener were stopped after verification; both existing PostgreSQL instances and the other audit's resources were preserved.

## Still required before release

Preview-only configuration writes remain awaiting the explicit permission already requested. The old hosted Preview also lacks the new wallet/metering schema and current renderer/source deployment. Hosted migrations/deployment require their own authorized scope and isolation checks. The separate audit's auth remediation and the AI branch must be composed into a reviewed release candidate and checked together. Live Stripe AI-credit configuration/payment verification and Production release authorization remain separate gates. Existing public URLs do not serve this new checkpoint.
