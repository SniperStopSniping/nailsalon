# Full reset and a fresh image

This supersedes the earlier fresh-design prompt in `artifacts/business-setup/start-over`. Runtime commits: `296fc83b` (full reset) and `c95aa4cc` (image-only Send).

## Owner experience

Start over → confirm **Start fresh & upload image** → choose a new image. No design description is required to reset. **Start fresh with an idea** opens the blank conversation instead. The current conversation, draft frontend, selected references/photos/logo, unaccepted upload summaries, unsent composer and unfinished setup answers are cleared. A first new design reference can be sent without typing an additional instruction. Uploading alone never makes a paid model call; the owner presses Send.

Confirmed live business settings/services remain authoritative and untouched. A published website continues to work. Resetting does not sign the owner out, delete appointments, change prices/hours/policies, replenish budgets or publish anything.

**Restore earlier draft** recovers the archived website/setup/image selections in a new private revision. Restoring does not reintroduce the old transcript into the new conversation. Old turns, revisions and assets remain private and recoverable according to existing retention. The asset library can still offer older uploads, but none are selected automatically after reset.

## Server boundary and compatibility

The owner-only reset/restore actions use the existing setup API and salon lock. They validate exact revisions, external changes, active operations and stable request identities. Lost reset responses reuse the original operation/revision; replay returns current saved work instead of erasing later edits. Concurrent resets are serialized. Restore translates published temporary service IDs through the original publication receipt and preserves newer live services, avoiding duplicate service creation.

Optional `sessionStartRevision` and `previousDraftRevision` fields live inside the existing immutable JSON setup document. No schema migration or new infrastructure is required. Legacy drafts use the initial revision as their boundary. Current timeline/upload reviews/design attempts and model history exclude earlier-session turns. Old message/design/edit retries are rejected. Internal session fields are excluded from owner-facing change summaries while remaining covered by exact-revision approval hashes.

Client recovery drops old cached requests when it detects a newer session. The custom studio is remounted, and reads from unmounted instances are invalidated so old images cannot reattach. Manual and AI editing still share the same draft. Publication remains separate and server validated.

## Deterministic verification

124 focused checks passed: 117 unit/component/PGlite/API checks across six files plus 7 tests against attested disposable PostgreSQL. After the final Send change, the 19 component tests were rerun. TypeScript, scoped ESLint and diff checks passed.

Coverage includes reset/cancel, immediate upload, image-only Send with no automatic paid request, stable lost-response identity, cached older-device requests, exact archive/restore, excluding old model context, tenant denial, stale edits, live-data preservation, published service-ID mapping, republishing without service duplication, simultaneous duplicate reset requests and competing tabs. Model outputs in deterministic tests are mocked.

## Hosted owner verification

Final runtime `c95aa4cc75ad4b51aa4185ff0f3af27f895e70e1`, deployment `dpl_EU4QjdduVzuPaN5kCLyUEd4B79RG`, READY Preview, build 3m56s. The shared test alias is https://luster-ai-builder-test.vercel.app/ai-website-test. No production deployment, merge, migration, customer-data change or outbound integration was performed.

Mobile Chromium (390 x 844) and desktop Chromium (1440 x 1000) passed the actual authenticated owner flow using a synthetic salon:

1. Cancel Start over; the exact draft remains unchanged.
2. Confirm Start fresh & upload image; empty chat, no custom frontend or selected images, cleared unsent text, upload controls open with My design or menu selected.
3. Upload the new synthetic PNG through the real owner file controls and confirm usage rights. Only the new reference is selected; no older photos/logo are inherited.
4. Verify that its thumbnail actually decodes and Send is enabled with an empty textbox.
5. Refresh and open another tab; the new image and clean conversation resume from the server.
6. Restore earlier draft; the prior frontend, business answers and services return. Hashes of canonical business settings and service rows remain unchanged throughout.

No hosted message/generation, publication, appointment, SMS or payment was submitted. The image-only message path was tested with mocked responses in the component suite; this checkpoint does not claim a new real-provider generation or Safari owner-journey pass. The earlier full-reset check is retained separately from the final image-only Send check.

The AI ledger remains unchanged: 81 hosted calls, CAD 32.826636 hosted plus CAD 6.384406 frozen local = CAD 39.211042 / 50. These are conservative application estimates, not a reconciled provider invoice.

- [Mobile fresh chat and new image](mobile-fresh-chat.png)
- [Mobile reset confirmation](mobile-confirmation.png)
- [Mobile upload controls](mobile-new-upload.png)
- [Desktop fresh chat](desktop-fresh-chat.png)
- [Machine-readable final checks](verification.json)

 The uploaded reference is explicitly a hand-authored synthetic PNG used to test uploads, not a model-generated website or an acceptance claim about visual design quality.
