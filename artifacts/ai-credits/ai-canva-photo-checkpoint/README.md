# AI Canva photo editing — source checkpoint

Base: `883ae1d752f21c5e9fe29ff9035a7ebd044a6157`. Extends the existing native photo actions to Canva artwork uploaded through AI, without requiring a manual-onboarding origin. This checkpoint describes deterministic local verification; it is not a real-provider or hosted owner acceptance claim.

## Owner outcome

The saved AI Canva design can receive a separate Gallery photo through the same owner controls used for manual Canva websites. Existing About/Gallery sections support adding, replacing, removing, describing, ordering and supported Gallery layouts. Chat uses the same validated actions and shared draft. Printed artwork remains fixed; these controls do not replace a photograph embedded inside its pixels or turn the artwork into editable HTML.

## Implementation boundaries

- The optional `storageKind: asset` image binding points to an existing salon-owned, immutable private photo in `custom_site_asset`. No migration, new media catalog, fake onboarding identity, provider URL or public upload is introduced. Missing storage kind retains the legacy onboarding binding and its exact salon/site/revision/role/ready checks.
- Dimensions come from the prepared WebP bytes, never the browser or model. Saving validates hash, byte size, format and dimensions; publication fully decodes the photos. A normal image request authorizes all pointers but reads only the requested image, rather than downloading the entire Gallery for each photo.
- About and Gallery can reuse one owned library photo with different placement roles. Reference images and logos are excluded from photo choices. A foreign salon, wrong storage discriminator, wrong role or forged dimensions cannot be saved. Existing library limits remain unchanged.
- AI Canva keeps its original compiler, page width, proportions, artwork positions and clickable areas when native sections are added. Native images travel through the existing authenticated lazy-image adapter, outside the inline artwork payload. The existing isolated renderer's `native-images-v1` contract is unchanged.
- Manual and AI photo changes share revision checks, owner authorization, immutable artifacts, atomic draft writes, exact artwork review and publication. Retained-result **Finish saving** recovery uses no additional model request. Restore recovers the earlier source while retaining current business settings.
- New-Gallery enrollment remains server controlled. Turning it off leaves approved photo reads and existing controls available. After saving an asset-backed photo source, rollback must retain a reader that understands this additive binding; do not roll back to a pre-binding app reader.

## Verification and limits

| Check | Result |
| --- | --- |
| Domain/API/compiler/intake/settings regression | 300 tests / 11 files passed |
| Owner composer, studio, photo controls, isolated frame and loader | 85 tests / 5 files passed |
| Scoped TypeScript, changed-file lint and whitespace | Passed |

The tests exercise wide/portrait uploads, idempotent retry, unchanged artwork and live services, no new onboarding aliases, photo-only conversation actions, retained-source recovery, link-generation preservation, source restoration, About replacement without changing salon/staff portraits, foreign/role/storage/dimension denial, shared-preview consent/revocation, exact reviewed publication/retry, disabled-enrollment reads and a private storage fault before publication.

The browser test must still be run against this committed source using the funded isolated synthetic account and the configured provider. No manually authored source fixture should be presented as automatic generation. The existing published example and appointments must remain unchanged during that trial. Combined release/CI/payment/security and broader design-quality acceptance remain open; PR #461 remains Draft and Production is unchanged.

The preceding `883ae1d7` Preview candidate reached READY and its health response identified that SHA with DB/Redis healthy and outbound-email/Calendar configuration absent. That candidate was not assigned to the user-facing test alias during this source checkpoint. This does not establish full release health.

No real-provider calls or new purchases were made while implementing this checkpoint. Read-only Preview accounting before the hosted trial still reported 170 calls, CAD35.896010 charged against the existing CAD68.615594 operator ledger cap. The user's CAD80 ceiling and the lower existing ledger were not reset or raised.
