# First preview without a mandatory intake interview

A first website request now creates a private custom frontend even when hours, working mode or priced services are incomplete. “Just make it up” invokes the custom frontend generator directly from saved details and selected references, without rereading the image or asking another intake question. Missing identity is displayed as Your salon / Your area only in authenticated preview data; no invented business identity, address or contact details are saved.

For a new unpublished business with no canonical services, the shared draft may receive a Signature appointment at 65 units of its saved currency for 60 minutes and suggested Tue–Sat 10:00–18:00 hours. These are illustrative editable values, not researched recommendations. Known values and explicitly set closed hours are preserved. Existing published salons receive no suggested operational changes during a visual request. There is no parallel service catalog or scheduling engine.

Suggested services remain unconfirmed. Suggested hours persist with an additive `hoursOrigin` field in the existing draft JSON and require owner acceptance or a manual hours edit. Model responses cannot confirm either. Exact revision approval, tenant checks, server-side preview booking denial, canonical service-ID publication and existing appointment preservation remain in place. Source generation no longer requires publication-ready business information. No schema migration is needed.

The first generated design opens automatically. Preview and Details clearly label suggested booking data; the owner can use chat and manual controls to revise it. Suggested hours have an explicit Use these hours control. Missing business identity and working mode still block publication.

Image extraction now uses actual nested objects/arrays in the model response schema rather than JSON encoded inside strings. Legacy saved/test responses remain readable. Invalid extracted facts are discarded rather than applied; an independently requested first visual preview can continue from saved data and labelled suggestions. Safe validation flags retain this distinction in the private ledger. Budget/provider/authorization failures still stop honestly.

The bounded trial conversation ceiling is 200 lifetime turns instead of 40. The affected test owner had 39 prior turns, including eight failed attempts. This does not reset counters or monetary budgets, expand model context (eight recent turns), or raise the approved cumulative CAD 50 cap. The existing generation and token limits remain.

## Deterministic verification

169 focused tests pass across six files: draft persistence/domain integration, first-preview intent, owner UI, preview payload, generated-source validation and isolated frame controls. Tests cover first creation before business readiness, suggested-hours/service approval, exact canonical publication and receipt replay, retaining explicit closed hours, existing salon preservation, malformed extraction and intake fallback, hostile/model confirmation attempts, refresh, UI transition, prior-attempt limits, sandbox protections and preview booking denial. Test model outputs are fixtures/doubles.

TypeScript, scoped ESLint and diff checks pass. Hosted real-provider verification follows below. No production deployment, migration, merge, live salon mutation or unrelated infrastructure change is authorized by this checkpoint.

## Actual owner-workflow trials

Backend/generation runtime `717f61ab976be0c0755d6c2dc82ccee9c8dda37b`, Preview deployment `dpl_BwGxsd7hZCKcL3Rf65mrXNxVYvhj`. Final owner UI runtime `210ee03e335c695a252927798d1d65179eb1cb74`, READY Preview `dpl_F1ibCV78YEHt9JHdqt8p49e1UAZa`, build 2m28s. The final commit only keeps business corrections available in chat for new salons after preview; its 23 component tests, TypeScript and scoped lint passed, followed by an authenticated hosted check with no additional model calls.

Stable link: https://luster-ai-builder-test.vercel.app/ai-website-test. Source changes are in draft PR #455. No production deployment or merge occurred.

A synthetic owner used the real mobile upload and chat controls with the actual provided reference. The affected owner's draft was not edited.

1. **Make exactly like this**: structured image intake through `gpt-6-luna`, followed by `gpt-6.1-sol` source generation. The first source contained a copied literal price and was rejected before rendering. The application's one metered automatic repair corrected it; the first and repaired outputs remain private in the existing ledger. Revision 31, artifact `20795fa7-26d2-4ef4-8e03-054d50f83bdc`, 172.444 seconds. Estimated USD 0.141041.
2. **Just make it up**: after Start over and another upload through owner controls, a direct `gpt-6.1-sol` generation produced revision 35, artifact `3e35bdd0-99de-4c0c-8f98-196a7b97cbed`, in 72.214 seconds. It did not reread the image or require missing setup answers. Estimated USD 0.058081.
3. **Keep the design, but change Signature appointment to $70**: `gpt-6-luna` updated the same service draft ID, revision 36, preserving the generated source/artifact. The rendered price changed to 70; canonical services remained unchanged and the suggestion stayed unconfirmed. Estimated USD 0.000884.

The first website opened automatically with suggested-data labels. Both journeys showed visible loading and immediately cleared the composer. Refresh and another tab retained the generated draft and suggestions. The review screen blocked publication on unconfirmed prices/hours and missing business facts. Preview Book Now remained disabled. No website publication or appointment creation was performed in these hosted trials; canonical publication/replay and original data mapping were verified in the isolated integration tests.

Actual renderer viewports of 1440px and 390px were verified on authenticated full-preview pages. The original builder screenshots labelled desktop had retained the mobile-size switch; separate full-preview captures correct that evidence gap. Both complete drafts were restored in turn through owner controls and the second draft's 70-unit price was restored with its original source. No restoration made a model call or changed canonical data.

All frontend code came from the configured model through the application. There was no hand-authored or developer-repaired source in these hosted results. The owner reference and screenshots remain private local evidence, not repository artifacts. Safe operation/revision IDs, validation results and usage are included in the JSON evidence files.

## Visual limits

The generated pages follow the reference's blush palette, decorative typography, framed panels and section flow. Original embedded nail/lash photographs were not separate authorized website assets and are omitted. System fonts and CSS gradients approximate the reference artwork; neither result is claimed as an exact Canva recreation. The first trial used the readable saved business/contact/policy details. The suggestion-only trial used generic identity and appointment guidance because no confirmed business/contact/policy data existed after reset. Service categories were not invented as a separate booking catalog.

## Usage

Five real calls across the two designs and the price edit used an estimated USD 0.200006, counted as CAD 0.400012 by conservative app accounting. The measured cumulative allowance is CAD 39.630204 / 50, including frozen local usage, with 96 hosted calls. This is not a reconciled provider invoice. No unrelated service or infrastructure was purchased.
