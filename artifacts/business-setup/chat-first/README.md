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

Screenshots in this folder show the actual application. Hosted verification and deployment metadata will be added after the committed source is built and checked.

No production deployment, migration or customer-data change. Generated sample websites are preserved. This checkpoint simplifies the builder UI; it does not claim completion of the broader AI feature or pixel-perfect Canva conversion.
