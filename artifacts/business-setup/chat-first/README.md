# Conversation-first owner builder

The default screen is now a single conversation with a bottom composer and an attachment button. Preview, manual business details, and exact publication review are opened on demand. The preview retains photo replacement/removal, matching preferences, source edits, recovery and design history behind collapsed controls. It no longer introduces a second generation composer.

The attachment dialog distinguishes owned designs/menus, third-party inspiration, website photos and logos. It requires permission before uploading and persists the same tenant-scoped assets/design brief used by the generator and manual editor. Owned designs default to close matching and can be read into a separate editable business review. Uploading does not spend model tokens, copy another salon's images, publish a site, or automatically accept extracted facts.

The chat shows the owner's request immediately, refreshes pending work, keeps unsent text after failure, and resumes stored messages and attachments. Desktop Enter sends, Shift+Enter adds a line; mobile Enter remains a newline. Native dialog focus is restored when closing. Server validation, exact approval, draft/live separation and existing booking logic are reused.

## Local verification

- 98 distinct automated tests passed across chat UI, timeline, authenticated API routing, PGlite draft/publication integration, source validation, payloads and isolated frame behavior (97 initially, plus one lost-response UI regression added and the 14 UI/timeline tests rerun).
- TypeScript and scoped ESLint pass.
- Real Chromium desktop, Chromium mobile and mobile WebKit checks: one visible composer, composer within viewport, no document overflow, attachment modal/focus, manual details and preview on demand, preserved message while switching views, exact review gate.
- A fictional Aster menu was uploaded via the real local API and appeared again after refresh. Test retries left two menu uploads in this disposable local fixture; neither affected a published salon. Local model credentials were disabled; these checks are not real-provider evidence.
- Existing browser journey selectors were updated for the new navigation. The old reset fixture has real-provider cost/evidence records, so the full destructive reset suite was not rerun against that database. Existing booking/publication safeguards were tested with the isolated PGlite integration suite.

Screenshots in this folder show the actual application. Hosted screenshots show the actual saved owner conversation, a new request, generation progress, result, preview and review.

No production deployment, migration or customer-data change. Generated sample websites are preserved. This checkpoint simplifies the builder UI; it does not claim completion of the broader AI feature or pixel-perfect Canva conversion.


## Hosted verification

Preview source `23aa096adf882f2cfbb0a99dde157168e4a07882` / `dpl_2MGAqXxo656XQG8tzishC2TVg95e` was built from the clean feature branch and assigned only to the isolated test alias. A real mobile owner session used the single composer to request more rounded booking controls and mobile breathing room. Astra (`gpt-6-astra`, OpenAI) generated revision17 / artifact `f171d670-aae1-4786-8685-253444241c0e` in54.1seconds end-to-end (provider51.2seconds), with11,751 input/3,564 output tokens. First validation passed, no repair or manual source intervention. Estimated provider costUSD0.325080; conservative tracked allowanceCAD0.650160. The model interpreted “main booking button” as the lower menu control; it disclosed that distinction. This is a real chat edit, not a new broad reference-fidelity evaluation.

The result appeared in Preview, survived refresh and could be reviewed. The business/service/hour/booking objects stayed byte-equivalent; the generated revision was **not published**. The anonymous public site still showed BIABCAD65 and its canonical service identifier, and its Book button opened the original Luster service/staff/availability screens. No additional appointment was created during this UI regression. Both existing published samples and their appointment counts/settings hashes were independently checked unchanged.

The hosted screen exposed two small usability refinements: returning from mobile Preview should show the latest messages, and detailed model caveats should sit behind a clearly labelled design-notes disclosure. The follow-up makes those UI-only changes; final hosted capture reuses the saved generated result without another model call.

Current CI is not a merge approval: the SMS PostgreSQL job failed while pulling its Docker image with `toomanyrequests: Data limit exceeded` (run38780629432/job116580507038), before application tests. The PR stays draft. No production merge/deployment or unrelated CLI upgrade.

Final Preview is READY at `115da49edf1f83a7323dca691151218f878fd967`, deployment `dpl_D8UPCqcbzfLZ9bMrMzCgBVERNkeq`. The test alias points there. Final owner browser checks passed at revision17: mobile/desktop, resumed conversation/attachments, latest-message position after returning from Preview, collapsed design notes and exact review. This final capture used no additional model call or publication. The existing published sample hashes and appointment counts remain unchanged.
