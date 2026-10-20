# AI setup: service pricing and artwork review checkpoint

This phase preserves Luster's canonical integer-cent booking prices and its existing `priceDisplayText` field. It does not introduce a pricing engine, duplicate service catalog, add-on management system or new billing rules. No deployment or production data change has occurred.

## Implemented behavior

- Existing “From” and custom price labels are carried into the shared setup draft, generated-site data bindings and production-component preview. Old saved JSON is hydrated on read without rewriting historical revisions.
- Changing a price updates a simple saved amount such as “From $65” to “From $75.00”. Price-only chat edits still use the existing service identity and preserve the custom frontend source, duration and other service fields. The model cannot change the label through the restricted price-only action; deterministic application logic handles it.
- A changed price with an ambiguous inherited range, another currency or embedded additional amounts requires explicit wording review. A newly supplied simple amount that disagrees with the booking price is also flagged. The private preview shows a review warning instead of the stale label, and server-side publication readiness blocks it. Accepting the numeric price alone cannot clear the warning.
- Details contains an optional collapsed price-wording control. Owners can correct or clear a label, see its exact before/after wording in Review, and save/resume. The internal review marker is not accepted in browser/model operations. Private street addresses cannot be inserted into public service wording.
- Own-menu extraction supports clearly readable starting prices as the canonical base amount plus a “From” label, pending owner review. Ranges and unclear amounts still require a base-price decision; extraction does not guess one. Readable upload facts can replace unconfirmed AI recommendations, while saved/owner-confirmed prices and their wording stay together until explicitly changed.
- Approved publication writes the canonical price and label together. The original booking flow uses them and retains historical appointment/service snapshots. Idempotent replay does not duplicate publication or services.
- New Canva artwork reviews bind price labels as well as the existing business-data fingerprint. A label-only change invalidates that artwork approval without breaking service click targets. Newly reviewed public artwork is withheld when its facts change. Already-published legacy artwork retains its existing guards and presentation; it gains the additional wording guard at its next reviewed publication.

## Verification and evidence

- 257 focused deterministic cases passed across 15 suites covering setup persistence, uploads, price-only conversation changes, owner controls, staff integration, custom-site validation and Canva behavior. Models/providers are injected test doubles where relevant, not real-provider acceptance evidence.
- All 56 original-booking PostgreSQL cases passed on the attested disposable loopback database, zero skipped. The added case books the original $65 service, changes the draft to $75, confirms that live price/wording remain $65, approves/publishes/replays, then completes a new original booking at $75 with the new label. The first appointment and its booked-service snapshots remain unchanged.
- Nine publication concurrency cases passed against the disposable PostgreSQL database. All 18 native CI-contract tests passed; CI now requires exactly 56 booking cases with zero skips.
- Three browser cases use the actual owner editor with synthetic API responses on desktop Chromium, phone Chromium and iPhone WebKit. They cover changing a starting price, refresh/resume, exact review, blocked stale-range wording and correction. They do not claim a real model generation or customer browser booking.
- Viewable screenshots are saved under `artifacts/ai-credits/pricing/`: reviewed, blocked and corrected states for all three device projects. TypeScript, scoped ESLint, whitespace and secret-tree checks are required before this commit.

The first browser run failed because the test clicked an already-open disclosure after returning from Review, closing the field it intended to edit. The corrected test follows the actual retained UI state; no forced clicks or hidden-field fills were used. Type checks also tightened the legacy read adapter's generic return type.

No real AI call, Stripe purchase or outbound customer communication occurred in this phase. The cumulative real-AI trial cap is unchanged.

## Remaining full-release work

Continue with supported add-on draft/edit/preview handling, deposit/reminder prerequisites, the first friendly booking URL, real paid-AI owner acceptance and the genuine walkthrough. Stripe sandbox purchase acceptance can wait for the owner's test key. Hosted Preview isolation, held push/PR updates, remote CI/review and production release gates still apply. The complete paid AI builder is not yet declared finished.
