# Native photo chat and retained-result recovery — local checkpoint

Base: `f5dd642e48b68949f496f15db9cf40f902e3ca09`. This source extends the owner conversation for separate About/Gallery photos on manual Canva imports. It is not yet hosted or verified with the real provider. The working test link still serves `0e65facb`; its preceding owner upload/review/publication/booking evidence is [here](../hosted-native-photo-checkpoint/README.md).

## Implemented

- The existing conversation model receives bounded, salon-scoped metadata describing native sections, ordered photos and authorized saved choices. It can propose removal, description, reordering, supported Gallery layout and use/replacement of saved photos. These use the same reducer and validation as manual controls. Native-only responses can apply through the conversation call without a full website generation, artwork rescan or source rewrite. An explicitly separate clickable-area/design request can still use the existing generation path.
- Printed Canva artwork and the separate native photographs have distinct capabilities. The prompt explains that it cannot redraw printed artwork. New photo identities, URLs, dimensions, roles, arbitrary sections, approval and publication are outside the model contract. Available metadata is bounded; image bytes and private storage URLs are not added to this context.
- Server code checks the complete batch before saving, rechecks owner permission and the exact draft after the model finishes, and rechecks the selected media's salon, immutable origin, role and ready state. A new Gallery also requires enrollment in application code, including direct saved-photo requests. Existing photo reads and edits continue with new-Gallery enrollment off.
- Source, shared draft, trusted action receipt and validation status commit together. Native changes reset artwork review and require exact owner review/publication. Generated success claims are replaced with a short summary of the commands actually applied. Business changes stay in the original draft: an explicit price plus photo request can save in one revision while the live service stays unchanged.
- A valid result that stops before its source/draft commit retains an application-written recovery marker and the validated setup operations. **Finish saving** revalidates that retained result without a provider call, new credit reservation, approval or publication. It refuses unvalidated/malformed output, another salon/actor, a new session, a newer draft or an actively saving request. Same-operation recovery is idempotent. A completed receipt returns the latest saved head rather than moving the owner UI over newer manual work.
- The owner sees saving progress and a disabled button during recovery. A lost recovery response is reconciled through the original message identity. Duplicate paid Retry buttons are hidden for a recoverable result; the owner's next typed idea is retained. Recovery remains available when AI generation is disabled because it does not make a new AI request.

## Verification

| Check | Result |
| --- | --- |
| Final domain/API/compiler/intake/settings regression | 291 tests / 11 files passed |
| Final owner composer, studio, photo controls, isolated frame and loader | 84 tests / 5 files passed |
| Scoped TypeScript including source, owner UI and API tests | Passed |
| ESLint and whitespace | Passed |

Tests use disposable PGlite accounts/private temporary image files and deterministic model responses. They cover ordered photo batches, manual/chat round trips, exact approved publication/media reads, unchanged live services/settings, tenant/role/approval injection, stale and revoked permission checks, first-Gallery flag enforcement, source rollback after an injected save failure, free retained-result recovery, paid-call/usage preservation, concurrent/manual price preservation, loading and lost-response UI behavior. An adversarial model reply claiming publication is replaced by the actual draft-change summary.

Initial failures were test-fixture issues: comparing the intentionally updated legacy draft pointer as live data, omitting the required specialty field in a concurrent copy edit, and failing to narrow provider-input union types in assertions. These were corrected without weakening ownership, scope, publication or live-configuration checks. Logs retain failed and final runs privately. Earlier overlapping sets are not added to the final counts.

The scoped check is not a whole-project CI claim. No package/dependency, migration, product-price, SMS-credit, new provider, infrastructure or Production change is introduced. No real AI call or customer-credit grant was made in this checkpoint. A read-only check found an existing funded synthetic test account; the manual Gallery test account still has zero customer credits. The approved operator trial cap remains unchanged, and provider-call count is still 170.

## Remaining acceptance

Deploy the committed source only to the isolated Preview and verify the owner-facing chat/recovery with the configured provider and existing test credits, retaining first/final output, usage and measured timing. Preserve its existing published example and appointments. Hosted About-photo upload/binding restoration, replacement/remove/fault/mobile/keyboard coverage, AI-preserved Canva photos without a manual origin, broader visual fidelity/settings/accessibility and combined release/payment/security checks remain unfinished. No new browser screenshot or real-provider result is claimed here; the complete AI builder remains incomplete and PR #461 stays Draft.
