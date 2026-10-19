# Asset-backed Canva photos: hosted publication and original booking

## Result

On the isolated Preview app at source `b738fca4`, the owner approved and published
the exact reviewed draft **97** with two asset-backed native Gallery photographs.
A signed-out browser opened that published site, followed its visible **Open
booking menu** link, and completed a real synthetic appointment using Luster's
original service, artist, availability and appointment-creation flow.

- Gel manicure: **CAD 50**, **60 minutes**, Morgan Test Artist.
- Wednesday October 21, 2026, **3:45 PM EDT**; **10-minute** booking buffer.
- Canonical appointment/service snapshots match the displayed booking values.
- All **11** prior appointments and all existing services/staff were preserved.
- Other businesses' salon, service, staff, appointment and asset digests match
  the read-only baseline.
- The prior published design was restored through owner review and publication
  of revision **98**, not through direct database edits.
- This checkpoint made **zero provider calls**, used **CAD 0** additional AI,
  and did not change Production, integrations, subscriptions or credits.

The prepared design came from the earlier actual AI Canva/photo workflow. The
owner deliberately replaced the printed Dynasty artwork with an owned synthetic
geometry fixture before this publication test: the synthetic business is Cobalt,
so approving another business's printed name and policies would be misleading.
This manual upload is disclosed. It is not a new AI visual-generation or reference
fidelity demonstration, and no developer-authored frontend was substituted for
model output.

## Security and recovery evidence

The same anonymous photo read returned **404 before publication**, **200 WebP**
for both photos after exact publication, and **404 again after restoration**.
Hostile-origin access returned **403**. Photo responses use `private, no-store,
max-age=0` and `Vary: Cookie`. The publication receipt was media-finalized before
success was recorded. The synthetic appointment remains after restoring the
website. Text consent stayed off; email was unconfigured, attempted no dispatch
work, and has no provider-accepted delivery. No payment was requested.

## Owner journey evidence

1. [Exact owner review](owner-exact-review.png).
2. [Publication success](published-receipt.png).
3. [Published desktop](published-desktop.png) and
   [390px mobile](published-mobile.png).
4. [Original availability](original-booking-availability.png), including staff
   eligibility, salon time and booking buffer.
5. [Completed original booking](original-booking-confirmed.png).
6. [Previous published design restored](prior-design-restored.png).

[Publication proof](publication-proof.json), [booking proof](booking-proof.json)
and [protected-data integrity proof](integrity-proof.json) contain safe identifiers
and results. Credentials, connection URLs, raw browser sessions, management-link
tokens and private uploaded content are excluded.

## Limits and improvements identified

- The first Chrome frame load stalled. One visible **Reload website** recovered
  it; a separate signed-out browser loaded automatically. The cause is not
  established, so this is not a claim that all first-load reliability is fixed.
- The portrait correctly retains its 2:1 height/width ratio. On a 390px phone it
  needs scrolling inside the website frame; this is a geometry fixture, not a
  professional finished salon design.
- The image was replaced through normal owner controls; its previous analysis
  notes remained visible although the image was wholly different. The follow-up
  fix clears old findings only for a new single-page design. A sharper copy of
  the same design retains notes, and multipage replacements retain notes because
  those findings are not page-scoped and may apply to remaining artwork.
- Review called a design-mode switch **Booking setting** and showed raw `rebuild`
  / `keep design` values. The follow-up fix says **How to use your design**, with
  **Create a new editable website** / **Keep my original artwork and make it
  clickable**. This is presentation only; approval hashes and publication rules
  are unchanged.

## Follow-up source validation

- Business-setup PGlite integration: **162 passed** (including new single-image
  findings reset, retained multipage notes, stale/tenant/idempotency protections).
- Owner UI: **45 passed**, including explicit design-mode review wording and
  unchanged exact approval/publication boundaries.
- Changed-file ESLint and scoped TypeScript: passed.
- These are isolated deterministic tests. The hosted publication/booking above
  ran against source `b738fca4`; hosted verification of the wording/notes fix is
  recorded separately after its committed Preview deployment.

The PR remains a draft with combined release/CI qualification outstanding. This
checkpoint does not authorize or establish Production readiness.
