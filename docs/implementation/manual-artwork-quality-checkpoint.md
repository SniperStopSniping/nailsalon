# Manual Your Design artwork quality checkpoint — 2026-10-18

The manual Canva path now distinguishes artwork from photographic uploads when saving its browser-local images to an account. Artwork attempts full-resolution PNG, then bounded full-resolution WebP encodes. It never squeezes a tall page into the photographic maximum edge. The receiving API uses the same artwork-aware server normalizer, with dimension reduction disabled for this path. If native geometry cannot fit the existing transport bound, the owner gets a separate-pages instruction; the original IndexedDB asset is retained. Ordinary photographic upload behaviour is unchanged.

This preserves supplied pixels and aspect ratio; it cannot recover unreadable text from an undersized screenshot. Lossless encoding is attempted first, but complex artwork may require lossy encoding at native dimensions. The existing size/background controls remain available. No AI call, subscription change, migration, hosted update or production-data change was needed.

## Verification

- 70 focused client, storage and API tests passed across four files. The real detailed-image boundary case needs a 20-second test timeout; its initial default-timeout failure is retained in the session evidence. It verifies rejection rather than silent shrinking, while the reference-analysis profile retains its separate bounded fallback.
- Six browser tests passed: tall 1200×4000, wide 1600×800 and small 279×1280 in Chromium and iPhone WebKit. Each used the real manual upload, clickable-area editor, background control, IndexedDB and shipped transport client. Visible pixels and alpha matched these synthetic PNG inputs, including full-resolution tall artwork. Links/background persisted through autosave and reload; originals remained intact. Initial browser failures exposed an observer reading before the existing 180 ms autosave and a pixel comparison counting invisible RGB under transparent pixels; those test assumptions were corrected without modifying application state or artwork.
- The browser harness doubles Clerk identity and the receiving account API. These results do **not** verify real signup, remote account persistence or production publication. The real server normalizer and tenant-scoped media API are covered separately by storage/integration tests.
- TypeScript, scoped ESLint and whitespace checks passed.

Screenshots and the safe evidence manifest are in `artifacts/ai-credits/manual-artwork-checkpoint/`. The synthetic striped fixture is deliberately a pixel/geometry probe, not a website-generation demonstration.

The browser cases were subsequently extended and all six passed again: the actual customer preview exposes `https://www.instagram.com/manual.test.studio/` as an external-window link. Evidence now captures the uploaded page/link controls and the customer preview separately. The initial extended observer looked for the shorter accessible name `Instagram`; the real link correctly includes the handle, and the observer was corrected. No application link repair was necessary.
