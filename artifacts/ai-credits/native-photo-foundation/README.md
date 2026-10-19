# Native About and Gallery foundation — local checkpoint

Base: `2a3e466c3fcdb46c16fd823e6265889b4a62b69d`. This is an additive, **not deployed** continuation of PR #461. It is not acceptance of the complete owner photo workflow or AI builder.

## Source outcome

- A manual Canva handoff can retain visible About content/portrait, selected gallery photos/order/layout, and selected real reviews. Hidden and demonstration content is excluded or rejected. About introductions retain the expanded biography, client appreciation, and enabled status details.
- About text uses the ordinary editable website-details draft. Photographs reference existing tenant-scoped private onboarding media, without duplicating gallery bytes into the custom-site catalog or AI context. Different image proportions are retained.
- The trusted parent requests only image IDs declared by the exact asserted source. The isolated renderer lazily requests visible photos. Two concurrent loads, bounded requests/cache, cancellation, failure handling, and channel/origin checks keep bytes and credentials out of generated code. The renderer's CSP is unchanged.
- Reads require owner authorization, an exact active private share, or an exact finalized public publication with matching current business facts. The route accepts no browser-supplied actor/salon authority. Private files are not promoted to public storage.
- Publication checks renderer capability and decodes saved photos before committing. Corrupt/missing files and incompatible renderers do not produce a receipt. Idempotent publication replay retains existing behavior.
- New photo handoffs require `CUSTOM_SITE_NATIVE_PHOTOS_ENABLED=true`. It defaults off. Photo reads intentionally do not require that enrollment flag, so disabling new enrollment cannot break already published websites.

## Local evidence

Synthetic PGlite accounts, temporary private WebP files, no external messages/payments or model calls:

| Check | Result |
| --- | --- |
| Domain, publication, HTTP authorization, schema, runtime and legacy regression set | 358 tests / 12 files passed before the final About-copy adjustment |
| Final About/import integration suite after copy adjustment | 14 tests / 1 file passed, including the new override/expanded-biography regression |
| Parent frame and bounded image-loader UI | 14 tests / 2 files passed |
| Scoped TypeScript after final copy adjustment | Passed |
| ESLint for all changed TypeScript, then final copy files | Passed |
| Renderer JavaScript/handler syntax and diff whitespace | Passed |

The integration suite covers hidden/missing/example images, cross-salon/role rejection, private/public/shared access, revoked shares, no live mutation during import, renderer outage, corrupt file preflight, safe retry/replay, and stale public facts. Runtime tests execute the actual renderer script in a DOM harness; they do not prove physical-device scrolling or hosted rendering.

Initial failures (missing passive `cite` validation, absent Instagram destination, payload object-identity expectation, and a successful-load retry cap discovered during review) were corrected with regression coverage. No permission, CSP, upload bound or booking rule was relaxed to pass them.

## Still required before enabling

- Owner controls for adding/replacing/removing/reordering native photos and their descriptions in the shared manual editor.
- Qualification of new About/Gallery uploads using isolated hosted storage; no Production storage/credentials may be borrowed.
- AI edits of those separate photos, and revision restoration that preserves their associated About text bindings.
- Hosted desktop/mobile, keyboard/touch, save/resume, publication and original-booking acceptance with the compatible renderer, then feature enrollment.
- Combined release dependency/CI/security/payment gates and remaining real-provider builder acceptance. This local checkpoint makes no new claim of visual reference recreation or real-model generation.

No environment values were written, no migrations were added/applied, no deployment was created, and no provider spending occurred for this checkpoint. The test alias remains on source `57446ad2605534947496cda670a9d5be6c063003`; its older renderer does not yet advertise native-photo capability. Keep new photo enrollment off until both are qualified. Once photo sites are published, a rollback must retain the compatible reader/schema/renderer; switching off enrollment alone is the safe immediate containment.
