# Hosted native Gallery photos — owner checkpoint

Source `0e65facb9d4d222f5cd97044852f28014f9220c0`. An owner can now upload Gallery photos beside an unchanged Canva design, edit their descriptions/order, resume the draft, review and publish an exact revision, then receive a real booking through the original Luster flow. This is **manual photo-control acceptance with clearly labelled synthetic dimension fixtures**, not a new AI design-generation or visual-reference trial.

## Actual owner/customer journey

1. Updated only the isolated Preview app and renderer, checking their project, Preview target and immutable source. The compatible app/reader both loaded the old site in the owner browser and signed-out Chrome. No handshake patch or generated-source repair was made. The earlier stall did not reproduce; its cause remains unproven.
2. Enabled `CUSTOM_SITE_NATIVE_PHOTOS_ENABLED=true` only for Preview on `codex/ai-website-release-20261019`, then rebuilt the same committed source and verified READY. No credential value was decrypted or changed. The test alias retains its existing protection configuration.
3. Restored the previously published design into private draft 17, preserving its artwork, booking areas, background, spacing and all live settings.
4. Used **About & Gallery photos → Upload a photo**: confirmed usage rights and selected a 1200 × 480 PNG, then a 480 × 960 PNG. The app showed saving progress and created drafts 18 and 19. The first Gallery was created by the upload; no second onboarding entry or business re-entry was needed.
5. Changed the wide image description (20), moved it after the portrait (21), then refreshed the owner page. Both images, the updated description and order resumed correctly. No HTML/CSS or database writes were used to substitute for those owner actions.
6. Opened the actual private preview. Lazy images decoded after entering view; both retained their native proportions. At a 390 × 844 CSS viewport there was no outer horizontal overflow. A private Book action reported booking disabled. A signed-out request for the unapproved photo returned 404 with an empty body and private/no-store plus Vary: Cookie.
7. Checked the artwork against the current settings, creating draft 22, and opened Review. Its only change was Website design; CAD, America/Toronto, 120-minute notice and 10-minute buffer stayed unchanged. **Approve and publish** completed. The database proves approval 22, publication 22, matching live artifact and completed media finalization.
8. Signed-out Chrome loaded both new photos through the public-authorized media path. Separate unauthenticated HTTP checks returned the exact approved WebP bytes; a cross-site request returned 403. The same artwork/service link selected canonical Gel Manicure, CAD 65 / 60 minutes, Taylor Test, the saved notice and buffer.
9. Original availability showed 19 times on Oct 21 with the existing 1 PM appointment protected. Using synthetic `.invalid` contact information, texts off and no deposit, completed one original Luster booking at 2:15 PM. The UI displayed Appointment confirmed. The persisted service snapshot is the original service ID, 6500 cents and 60 minutes, with a 10-minute buffer / 70-minute blocked duration. A fresh availability page showed 14 times, removed the new reservation and retained 3:30 PM onward.

## Viewable evidence

- Uploaded dimension fixtures: [wide](uploaded-wide-fixture.png), [portrait](uploaded-portrait-fixture.png).
- [Draft gallery on desktop](draft-gallery-desktop.jpg), [portrait at phone width](draft-portrait-phone.jpg). A tall image scrolls vertically; it is not cropped to fit one screen. Photos retain the original pixel detail; upscaling cannot invent missing detail.
- [Exact review](exact-review-phone.jpg), [owner Published state](published-owner-phone.jpg), [signed-out published gallery](published-gallery-desktop.jpg).
- [Original availability before](original-availability-before.jpg), [completed booking](original-booking-confirmed.jpg), [updated real availability](original-availability-after.jpg).
- [Safe configuration, revision, media, booking and isolation proof](proof.json).

## Boundaries and checks

All 18 other isolated businesses and their appointment fingerprints are unchanged. The original test appointment remains unchanged. Six canonical services, prices, hours, staff and booking settings remain unchanged. Exactly two new private assets and two media aliases were created; existing legacy claims/revisions were retained. Exactly one additional appointment was created through the customer UI.

Provider call count stayed 170: **zero new AI calls and CAD 0 incremental provider usage in this checkpoint**. No purchase, credit grant, package installation, global CLI upgrade, migration, Production change or main merge. SMS was off; Resend sender configuration was absent. The new appointment has an unsent email intent (zero attempts) and failed delivery records without provider acceptance, rather than a claim that confirmation email was delivered. No real payment was requested or collected.

Local source qualification remains 223 backend tests / 5 files and 41 UI tests / 4 files with scoped types/lint; those deterministic suites were not needlessly rerun for these evidence-only files. Hosted source compiled and completed its Vercel build. This is not a green combined CI or Production-release claim. PR #461 remains Draft and conflicted with main; the coordinated release task owns combined qualification.

A diagnostic assertion initially read only the first duplicate Vary header and reported missing Cookie. Inspecting all header values confirmed Cookie was present; the harness was corrected without changing application headers. The default screenshot surface included unused browser space after viewport sizing; phone captures use the actual 390-pixel content area. Neither adjustment repaired application source or generated design output.

## Still incomplete

The hosted journey qualifies native **Gallery** upload, description, reorder, refresh, exact publication and original booking on a manual Canva import. Hosted About-photo upload/binding restoration, replacement/remove/re-add and broader keyboard/touch/fault journeys still need acceptance. Native-photo chat edits and AI-preserved Canva photo support without a manual origin remain unfinished, along with the remaining funded real-provider, design-fidelity, settings, accessibility, payment/security and combined release gates. Ordinary photo controls do not complete the AI custom website builder.

The current public test link serves source `0e65facb`, with the matching native-image renderer. Do not roll either reader back to a pre-native version after this publication: retain the compatible read path even if new-photo enrollment is disabled.
