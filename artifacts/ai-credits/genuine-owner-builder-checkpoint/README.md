# Genuine owner → AI custom website → original booking

October 18, 2026. Application commit `4a3ec9a1`; isolated local Development application and attested PostgreSQL database. This extends the [real Clerk signup/verification checkpoint](../clerk-owner-checkpoint/README.md). No production deployment, live salon change, real payment or outbound customer message occurred.

## What actually ran

1. A normal UI-created Clerk Development owner verified their email, opened exactly one private salon and signed in again from a completely fresh browser without copied cookies.
2. The owner typed Lumen Studio's business information, hours, solo working arrangement, BIAB at CAD65/60 minutes and Gel Manicure at CAD45/45 minutes. The real Luna call saved the structured draft; no live service was created.
3. The owner uploaded the supplied green floral reference through the normal attachment dialog and sent a short inspiration request. Real Sol generated the frontend; its validated first output was saved as revision 4.
4. “Make the mobile version less crowded…” produced revision 5 through real Luna. Independent comparison confirms only mobile CSS changed: HTML, interaction code, desktop rules, reduced-motion rules and business settings stayed unchanged.
5. Manual text editing worked through the actual editor. That deliberate test was restored before publication. The owner restored the original design and then the mobile revision through saved history, without resetting business settings or spending AI credits.
6. The owner reviewed and approved exact revision 9. The test dropped the successful publish response; reload recovered the published receipt. There was exactly one receipt and two live services.
7. An anonymous customer clicked the generated BIAB card, used the original Luster availability/calendar/contact/review/confirmation flow, submitted once and received 201. One genuine local appointment was created at CAD65 for 60 minutes with the eligible solo technician.
8. “Keep the design, but change BIAB to $70” updated the canonical service-setting draft at revision 11 without generating source. The draft preview displayed CAD70 while the public site still displayed CAD65. Approval/publication of revision 12 updated the live binding. A second original-flow booking cost CAD70; the earlier CAD65 appointment and its stored details remained unchanged.

Every model request ran through the owner-facing chat. There was no manually authored frontend substitute and no developer repair to model source. Application validation and deterministic contact/data binding remained active. First provider responses and final immutable artifacts are retained privately; all six calls passed validation on their first attempt.

## Viewable evidence

- [Business intake](business-intake.png), [reference upload and prompt](reference-input.png), [submitted/loading state](generation-progress.png).
- [Original inspiration](inspiration.jpg), [generated desktop](generated-desktop.png), [generated mobile](generated-mobile.png).
- [Chat revision](chat-revision.png), [manual editor](manual-edit.png), [restored design](restored-design.png).
- [Exact review](exact-review.png), [publication recovered after lost response](publication-recovered.png).
- [Original booking confirmation](original-booking-confirm.png), [completed CAD65 appointment](original-booking-65.png).
- [CAD70 draft](draft-price-70.png), [unchanged CAD65 public site before approval](public-price-65.png), [completed CAD70 appointment after approval](original-booking-70.png).
- [Fresh-device sign-in](fresh-device-mobile.png), [independent mobile-edit comparison](mobile-edit-proof.json), [database checks](database-proof.json), [full sanitized run register](evidence.json).

## Quality, cost and limitations

The result carries over sage colour, a floral hero, dark serif hierarchy and rounded cards, with a two-column desktop service menu and one-column mobile menu. The model drew original SVG flowers instead of reproducing the reference photograph and used the owner's saved information instead of another salon's policies or branding. This is an inspiration interpretation; it is not an exact Canva reconstruction. Fixed-artwork clickable Canva mode has separate existing acceptance evidence.

Measured provider usage: six real OpenAI calls, comprising Luna intake/routing, one Sol generation, a Luna mobile revision and one Luna price-setting edit. Estimated provider cost from the recorded token usage and pinned API rates: USD0.062413, approximately CAD0.0874 at the configured 1.4 exchange assumption. Retail test credits used CAD0.174759. The conservative shared operator budget retained CAD0.124826 for these calls; its existing local cap was not raised or reset. This was a synthetic CAD10 recovery grant, not a Stripe purchase or revenue.

Sol generation took 97.3 seconds; the mobile source edit took 44.5 seconds. Those are observed provider times, not production latency promises. The local Next development server first took 105 seconds to compile the public service route. One publication preflight timed out before approval, and two browser booking attempts timed out during cold/partially warm navigation before any submission. All failures are retained in the register. The fully warmed booking run and later-price booking passed with no booking-source change. Cold development behaviour must not be presented as a production speed test.

Current focused checks: 18 component/page/identity cases, 12 harness/isolation cases, scoped ESLint and TypeScript pass. This checkpoint proves a real owner account can generate, revise, approve, publish locally and receive original-system bookings. It does not complete Stripe sandbox purchase acceptance, optimized genuine-auth browser coverage, hosted-preview isolation, combined-release CI/review or the protected-main production release. Push and deployment remain held.

Credential scan: the normal scanner refused four development bundles above its 5 MiB file limit. An unchanged-rule private scanner copy with a 16 MiB allowance scanned all 4,729 tracked files and all 96 development client files successfully; an additional exact-value check found zero occurrences of either configured server credential in those client files. No scanner rule or application credential was changed or excluded. The normal optimized-build scanner remains a release gate.
