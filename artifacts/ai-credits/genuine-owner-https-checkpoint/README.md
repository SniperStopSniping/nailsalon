# Genuine owner: optimized HTTPS, publication and original booking

October 18, 2026. Application commit `aebc7b0c29329172f221ea12320ceb4f2210e96b`, Node 24.11.1, Next 15.5.25. This is an isolated loopback HTTPS check, not a hosted deployment. It extends the [actual owner-to-AI-generation checkpoint](../genuine-owner-builder-checkpoint/README.md); the existing Sol/Luna-generated frontend was reused without source repair or regeneration.

## Owner experience verified

- A completely fresh browser signs in through the actual password UI, with no restored cookies, sign-in ticket, seeded Clerk user or legacy admin session. The same verified owner reopens the same salon. The iPhone-profile saved-page entry and refresh pass.
- Desktop **More → Luster AI** and fresh iPhone-profile sign-in through the AI introduction both reopen that saved website. Owners do not enter business information or services again. [More](more-entry-desktop.png), [AI introduction](ai-intro-sign-in-mobile.png), [reopened phone preview](ai-intro-saved-mobile.png).
- The first saved-site edit/publication cycle ran in WebKit with a desktop owner viewport and a narrow customer viewport. BIAB changed from CAD70 to CAD75 in the real service draft. [The owner draft showed CAD75](draft-price-75.png), while [the anonymous public site still showed CAD70](public-price-70-before-approval.png). The underlying source identity and source hashes did not change.
- The owner [reviewed the exact before/after](exact-review.png), approved revision 14 and published. The test deliberately dropped the committed successful response. [Refresh recovered the published result](publication-recovered.png), with exactly one receipt for revision 14 and no duplicate services.
- An anonymous customer selected the real BIAB identity from the generated frontend, used the original calendar, contact form and review, then received HTTP201 and a persisted CAD75/60-minute appointment with the eligible Synthetic AI Owner. [Original review](original-booking-review.png), [completed booking](original-booking-completed.png).
- A separate deliberate preview-ID submission was rejected with HTTP400 `INVALID_SELECTION`. The recorded submission count is two: one genuine booking and one negative security probe. There was exactly one new appointment. Earlier CAD65/CAD70 appointment rows retained their full fingerprints.

The first cycle's narrow WebKit viewport is not claimed as a full iPhone device simulation.

## Complete iPhone touch cycle

The final run uses the iPhone 13 profile with mobile layout, DPR3, a 390×844 viewport and touch enabled. Primary editing/review/publication and original-booking controls use actual `locator.tap()` actions. This is emulation, not a physical-device test.

1. The owner tapped **Make more changes**, loaded the current canonical CAD75 services, and saved a CAD80 BIAB draft. [Phone draft controls](iphone-draft-price-80.png), [proposed menu](iphone-draft-services-80.png).
2. The anonymous public page [remained CAD75 before approval](iphone-public-price-75-before-approval.png). No appointment or source artifact changed.
3. The owner [reviewed the exact change](iphone-exact-review.png), approved revision 16 and recovered [the committed publication after a dropped response](iphone-publication-recovered.png). There is exactly one revision-16 receipt.
4. An anonymous touch-profile customer used the generated service button and original calendar/form/review/confirmation. [Published website](iphone-published-website-80.png), [original review](iphone-original-booking-review.png), [completed CAD80/60-minute appointment](iphone-original-booking-completed.png). HTTP201 created exactly one appointment with the eligible artist. A separate preview-ID probe returned HTTP400.
5. The earlier CAD65/CAD70/CAD75 appointment fingerprints remained identical. A separate before/after hash check confirmed publication did not change the existing synthetic salon-client record. There was no linked global-client record in this fixture; none is claimed as tested. [Customer preservation](customer-preservation-proof.json).

[Touch journey register](iphone-touch-journey-proof.json) and [final database proof](iphone-database-proof.json) retain device measurements and exact outcomes. This WebKit build reports `navigator.maxTouchPoints=0` despite its enabled touch profile; the first two metadata checks stopped before mutation. The final harness records that value honestly, validates the configured device profile and requires real tap actions to succeed. No navigator property or generated source was modified.

## Findings corrected

The AI page now waits for Clerk's browser token refresh before mounting its API-driven editor. A missing initial cookie returns a generic recovery screen, which repeats the unchanged server ownership guard once after SDK readiness. No salon information or editor is sent by that recovery state. Permission failures remain hidden; authorized legacy sessions keep their existing path. SDK loading and recovery have bounded waits and explicit retry actions.

Browser diagnostics found that the installed `setupClerkTestingToken` helper replayed Frontend API requests and rewrote captcha flags. In the observed WebKit run, the following setup request reached the server without cookies. With the same application build, using Clerk's documented [`__clerk_testing_token` parameter](https://clerk.com/docs/guides/development/testing/overview#testing-tokens) through native `route.continue` resolved the observed loss. Provider responses and browser authentication cookies are unmodified. This is evidence about this isolated test transport, not a universal Clerk diagnosis. The helper grants no identity or salon authority.

The test also stopped leaving the dashboard's loading screen prematurely: it waits for the actual More control. Wire diagnostics record cookie names and SDK status only, never values, account identity, query strings, credentials or request bodies.

Failed attempts remain private. Some initial credential-collection runs could not retrieve discarded navigation/prefetch bodies, and one collector wait was interrupted. The final check explicitly covers rendered documents, builder API responses, static client files and renderer text responses, with no unreadable response in that scope. Plain-HTTP Safari sign-in did not complete and is not treated as HTTPS acceptance.

## Checks and evidence

- 31 focused page/session/account tests, scoped ESLint and TypeScript passed. Sixteen native authentication/network tests passed.
- The exact committed optimized build passed compilation, types, page generation and packaging. The standard scanner covered 4,736 tracked files and 600 generated files. Across 618 public files, the server-only canary had zero matches. [Build proof](optimized-build-proof.json).
- Genuine browser checks inspected rendered account/owner/preview documents and critical text responses, with zero provider-key matches and zero browser errors. [Saved iPhone entry](saved-auth-proof.json), [More entry](more-auth-proof.json), [AI-introduction entry](ai-intro-auth-proof.json).
- [Journey register](journey-proof.json) and [independent read-only database checks](database-proof.json) retain exact revisions, canonical service identities, immutable source hashes, receipts, booking outcomes and historical fingerprints.

All model credentials were absent from this optimized runtime; outbound OpenAI was blocked. Entry-only checks enabled the normal account/More paths while retaining those restrictions. No additional model call or AI expense occurred. The existing six owner model calls remain unchanged. The local cap is CAD11.384406, charged/retained CAD9.578990, with zero pending calls; the unchanged hosted allocation keeps the shared cap at CAD80. Unknown prior expenses were not released or reset. Test funding is the previously declared synthetic CAD10 recovery grant, not a Stripe purchase.

## Remaining release gates

Stripe sandbox checkout and signed webhook acceptance still await the deferred test configuration. Hosted credential/Redis/upload/job isolation and the current renderer deployment still need completion before the held push/PR/preview update and combined protected-main release checks. Production, live salon data and production migrations were not changed.

The review also repeats a retained inspiration selection as “Before: Not set” during a price-only edit. Its baseline comparison should be corrected before release; the source hashes and actual public design remained unchanged. This checkpoint does not declare the complete paid builder released.
