# Canva size, links and resume checkpoint

Application source: **`6584d6b421f5c059ac0ebbb292478e84a652754c`**, on the isolated combined candidate branch. Nothing was pushed, deployed, promoted or changed in hosted configuration or Production.

## Owner-visible change

In connected **Your Canva Design** setup, choosing **Fit to screen**, **Wide & centred** or **Full width** now saves immediately to the same device draft as the artwork, links and background. Owners can close or refresh without losing that size choice. A failed save keeps the previous size and shows a plain retry message. Existing standalone upload callers retain their explicit Save handoff; page-order confirmation is unchanged.

The native browser investigation found that background and link changes already persisted immediately, while size changes were staged until Done/Preview. The first private runner also sampled the background before browser persistence completed; that was a harness timing error. After waiting for persistence, the missing immediate size save remained reproducible. No provider failure, AI-source repair or generated-design change was involved.

## Verification

- **30 dialog unit tests passed**, including immediate size persistence, retained artwork/background/links, failed-save behavior, existing standalone Save behavior and page-order guards. Zero skipped or failed tests.
- **Six browser fixture cases passed** with zero retries, skips or flaky results: tall 1200×4000, wide 1600×800 and small 279×1280 artwork on desktop Chromium and iPhone-emulated WebKit. They exercise manual link placement, immediate size saving, cream background, lossless transport preparation, reload and the actual Instagram href. Receiving account/media APIs are explicit deterministic doubles in these fixture tests.
- **Six separate native application cases passed on the exact optimized source above**, without mocked application responses: the same image shapes on desktop Chromium and mobile WebKit. The preview's Desktop/Phone controls were selected explicitly. Each image loaded at its original dimensions and retained its proportions. Each Instagram hotspot was actually clicked and triggered the expected Instagram navigation; the external request was blocked rather than contacting Instagram. Local application mutations were guarded and none were attempted.
- A separate mobile native case changed size, closed the editor **without Done or Preview**, refreshed, and retained the exact saved artwork and size.
- Full root TypeScript checking and the fresh optimized build passed. The scanner inspected **4907 tracked /600 generated files**, with zero server credential-canary matches. Scoped lint found zero errors, seven retained component warnings and no browser-test warnings. The unchanged protected-surfaces CI step passed on6584d6b4.

[Native results](native-proof.json) · [Close/refresh result](close-reload-proof.json) · [Automated results](test-proof.json) · [Optimized build](build-proof.json) · [Attempt notes](attempt-notes.json).

Screenshots use synthetic striped artwork to test dimensions and transparency; they are not AI-generated salon designs or reference-recreation demonstrations.

- [Desktop landscape preview](wide-desktop-preview.png)
- [Mobile small-artwork preview](small-mobile-preview.png)
- [Mobile manual editor](small-mobile-editor.png)
- [Mobile after closing and refreshing](close-reload-mobile.png)

## Safety and limits

Read-only fingerprints of both protected synthetic salons' setup heads, services, appointments, custom-source artifacts, credit entries and model-call records were unchanged across the six native cases. No new model calls, purchases, bookings or outbound customer communications occurred. The existing Cobalt salon still has its two earlier synthetic appointments; this phase did not repeat booking creation. Owned application, renderer, proxy and fixture servers were stopped afterward.

These cases cover device editing and preview before account claim. They **do not** prove native account-media transfer, hosted Cloudinary storage, hosted publication, a new AI generation, physical-iPhone behavior or a new customer booking. The earlier genuine original-booking evidence remains in the [combined checkpoint](../combined-local-candidate-checkpoint/README.md). The separate [Preview release gates](../preview-release-gate-checkpoint/README.md), including pending permission for Preview configuration writes, remain in force.

Only this task's recomputable caches from three old private build directories were removed to make space for the fresh build. Source archives, build metadata, server/static output, certificates and prior evidence were retained and checked. Resource guards were not weakened. The [manifest](manifest.json) uses explicit path/sha256 entries; raw browser sessions, private logs and keys stay outside Git.
