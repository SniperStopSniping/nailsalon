# Native photo uploads and design recovery — local checkpoint

Base: `4ebb7b4b10c5fe4f1da6c4ba2c1a4a5fc29fbc43`. Continues the shared-draft photo controls. This checkpoint is **not deployed**; native-photo enrollment remains off.

## Implemented

- The owner panel accepts a new About or Gallery photograph, including replacement of the selected photo. It requires upload rights, uses the existing client image preparation, and reports preparation/saving progress. A design without a Gallery can gain its first Gallery through the same upload, without re-entering business setup or returning to onboarding.
- The server reuses the private immutable website-image library: image validation/normalization, content hashes, deduplication, existing quotas, and the Preview-only private-byte adapter. New media aliases reference those same objects. No new storage service, public URL, catalog, credentials or migration is introduced.
- Native uploads never call onboarding's canonical identity-promotion path. A portrait upload cannot update the live technician avatar, salon logo or public website. New aliases, the new source and its draft application commit together. If the business changes after storage, the transaction rolls back the alias/source; a reusable private library image may remain. This is explicit, bounded and not public publication.
- Same-operation retries reuse the immutable source and alias; invalid roles, wrong salons, stale revisions, disabled enrollment and unsupported files fail without activation. Existing source/page/link objects remain unchanged.
- Owner restoration retrieves the exact selected source's first applied About wording, restoring its canonical text bindings rather than showing blank/missing paragraphs after a reset. It retains the current business, prices, contacts and unrelated website notes. Its single draft edit is idempotent, rejects stale requests, and refuses historical About text that would expose a now-private address. No appointments, messages, payments or live prices are reversed.
- Photo preview effects use the immutable source ID and selected photo ID, so ordinary polling does not restart an unchanged image load.

## Local evidence

| Check | Result |
| --- | --- |
| Onboarding/handoff/native-photo/restore integration, owner API, Canva compiler/schema, business-setup regression | 223 tests / 5 files passed |
| Native editor, owner studio action wiring/recovery, isolated frame and bounded loader | 41 UI tests / 4 files passed |
| Focused final native/API rerun (overlaps the above) | 37 tests / 2 files passed |
| Scoped TypeScript including new source and tests | Passed |
| ESLint and whitespace checks | Passed |

Tests use synthetic PGlite accounts and actual normalized temporary WebP files. They verify wide/portrait dimensions, duplicate-free replay, public denial before approval, exact approved publication/photo reads, unchanged canonical identities and services, rolled-back stale uploads, new Gallery creation, preserved newer draft prices/contacts, and private-address/foreign/staff restoration rejection. UI tests use deterministic HTTP fixtures and test exact multipart fields, upload rights, loading/disabled states, and lost responses without resubmission. They are not hosted browser proof or real AI generations.

Early failures were an uninitialized foreign test salon, accidentally passing persisted service provenance into the strict input schema, and a redundant type guard. Fixtures/types were corrected; no authorization, MIME rule, quota, privacy check or approval boundary was relaxed. Failed logs remain private. The final copy-only privacy error clarification does not alter the tested rejection behavior.

## Limits and next qualification

This upload path currently applies to Canva sites imported from the existing manual workflow. Generated editable frontends retain their existing photo path. AI-preserved Canva sites without a manual origin and chat-based edits of native photos still need connecting; those are not considered complete.

New uploads retain the existing private library allowance (24 images/references and 15 MB total, alongside existing prepared-photo bounds). Existing native Gallery records up to the supported 60-photo display limit are retained without duplication. This work does not silently raise storage/AI budgets or change product pricing.

Still required: the compatible renderer/app deployed to the isolated Preview, an owner upload → draft → exact review → publication → original-booking browser journey with desktop/mobile/save-resume checks, chat edits of native photos, remaining real-provider/fidelity and combined release gates. No new hosted screenshots or recording are claimed here.

No environment writes, migration, real model call, credit grant, purchase, deployment or Production data change occurred in this checkpoint. The hosted test alias still serves source `57446ad2605534947496cda670a9d5be6c063003`, with its prior renderer. Keep enrollment off until the new runtime and the full hosted photo journey are qualified. Previously published photos must retain a compatible reader/schema/renderer when rolling back.
