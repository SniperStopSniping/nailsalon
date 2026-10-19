# Human owner workflow: unchanged Canva artwork with AI links

Actual hosted UI test on 16 October 2026, using an existing synthetic salon in the isolated Preview database. No production data, manually repaired generated source, or mocked model response was used.

## Ordinary owner actions

1. Signed in normally, opened the separate synthetic salon, selected **Start over → Start fresh & upload image**.
2. Chose **My design or menu → Keep my Canva design**, uploaded the [owned synthetic input artwork](input-artwork.png), confirmed ownership, and clicked **Add to chat**.
3. Sent “Keep this design and make the links clickable.” Real OpenAI `gpt-6-luna` extraction/link generation created revision **79**. This mode preserves the uploaded raster artwork; it does not generate new artwork or rebuild the layout.
4. Sent “Make the Gel manicure card book that service directly. Keep the rest the same.” Refreshed while it was running. The saved operation completed as revision **80** without resending it.
5. In the link controls, changed the accessible booking label manually, saved revision **81**, checked the printed artwork, reviewed and published exact revision **82**.
6. Opened the published website, clicked Instagram, and then selected the Gel manicure booking area. This opened Luster's existing service/time/confirmation journey with the correct canonical service, $65, 60 minutes, solo staff eligibility, weekday hours, two-hour notice and ten-minute booking buffer.
7. A real synthetic appointment was created (HTTP **201**). Database comparison confirmed both earlier appointments retained their price, duration, staff and times. The canonical service count stayed one.

The four actual provider calls cost an estimated **USD $0.002972 / conservative CAD $0.005944**. Cumulative tracked/reserved allowance: **CAD $40.247952 of $80**. This is app accounting, not an invoice reconciliation. Raw provider outputs remain privately retained in the existing call ledger.

## Reproduced and fixed

After publication, a signed-in owner following **Open your booking website** saw the legacy private native layout. A signed-out customer saw the correct Canva design. Commit **47d3323b** makes that owner link explicitly select the already-published LIVE website. It also preserves that selection when the custom site's booking control opens the native booking menu.

This query cannot admit an unpublished salon or reveal a draft. The dedicated authenticated owner-preview route ignores it. Default manual preview behavior remains unchanged.

Application Preview **dpl_6YiTzTiZCy2RsHZ7smcdThmUgrG4**, source **47d3323baa28d57741b9198cf9f34d33da21b1d5**, was READY before only the test alias was assigned. The corrected owner click was repeated through the visible UI, then the customer booking was completed on that runtime.

[Tested published website](https://luster-ai-builder-test.vercel.app/ai-clear-verified-4893fc4c2704/book/service?publishedWebsite=1) · [Owner builder](https://luster-ai-builder-test.vercel.app/ai-website-test) · [Verification data](verification.json)

## Evidence

- [Upload](01-upload.jpg), [sending/loading](02-sending.jpg), [follow-up loading](04-follow-up-loading.jpg), [resumed chat](05-refreshed-result.jpg).
- [Exact review](07-exact-review.jpg), [published result](08-published.jpg).
- [Owner before fix](owner-open-before-fix.jpg), [owner after fix](owner-open-after-fix.jpg), [public mobile](10-public-mobile.jpg).
- [Original service selection](11-original-service-selection.jpg), [booking review](12-booking-review.jpg), [completed booking](13-booking-confirmed.jpg).

The published browser used exactly the saved normalized upload bytes. At 390px, the page had no horizontal overflow and all five image link areas were 47.664px tall. Instagram actually opened the expected URL in another tab; the synthetic handle is not claimed to represent an existing Instagram account. Phone/email URI targets were checked without calling or sending.

## Verification and limits

- 238 focused business-setup/custom-site tests pass; 7 PostgreSQL concurrency tests skipped without an attested disposable database. An additional 47 route/auth tests pass (the combined regression run also included 25 overlapping UI tests).
- TypeScript, scoped ESLint and diff checks pass. Desktop and 390px customer/owner views exercised through browser UI; no physical iPhone or fresh WebKit run claimed.
- Synthetic SMS opt-in was disabled. The new appointment's two queued email/calendar jobs were marked failed to prevent retries. No design or appointment records were repaired through DB writes.
- This is an existing-salon preserved-artwork journey, not a new-owner business-intake or fresh custom-HTML generation demonstration.
- Remaining usability issues: published studio previews retain some draft wording; the review exposes internal IDs for some website-content changes. Raster artwork scales without text reflow and printed values require a new export.
- The broad draft PR CI is not green. At the snapshot, application tests and D5/L1 concurrency jobs failed; other checks were still running. Causes have not been diagnosed here. Health reports `degraded` despite successful feature requests. No full-release or whole-application health claim is made.
- Production was not merged, deployed, migrated or modified.
