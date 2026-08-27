# Custom Design Phase 1

This directory contains the independent Custom Design infrastructure. It is not
connected to the universal Builder shell yet. Phase 2 must integrate it only
after rebasing onto the committed foundation-correction HEAD.

## Boundaries

- `model/` owns serializable settings, validation, structured actions,
  normalized geometry, replacement review rules, CTA placement, and the
  truthful backup manifest.
- `assets/` owns Lab-only browser blobs, image preparation, object URL leases,
  and conservative reference-aware cleanup.
- `components/` owns self-contained customer rendering and pure owner preview
  surfaces. Callers supply resolved assets and action destinations.

The main Site Builder document stores image and interaction metadata only. It
must never contain `Blob`, `File`, base64/data URLs, or object URLs. IndexedDB
uses separate summary-metadata, original-blob, and thumbnail-blob stores,
outside document history and localStorage. Metadata reads never clone either
blob; thumbnail and original reads open only the blob store they need.

## Upload transaction contract

IndexedDB and document history cannot share one atomic transaction. A Phase 2
upload coordinator should:

1. validate/decode every selected file and report per-file failures;
2. stage each successful asset;
3. commit the staged assets;
4. apply one validated document command for the successful image items;
5. delete newly committed assets if the document command fails and no current,
   removed, past, or future history snapshot references them.

Staged records are intentionally invisible to normal reads. Cleanup must scan
the current document plus every live history snapshot, and must not delete an
asset referenced by a removed/restorable section. Object URL consumers acquire
a lease and release it on unmount; replacement invalidates the previous URL.
Read paths diagnose missing/corrupt companion records, while an authorized,
reference-checked delete remains idempotent and removes every surviving store
record so recovery cannot leak a stranded blob.
Abandoned staged writes are eligible for conservative cleanup only after the
24-hour TTL, after excluding active transaction IDs, and after one final
coordinator-owned confirmation immediately before discard. Cross-tab mutation
serialization remains a Phase 2 responsibility.

## Persistence truth

- Reload on the same origin/browser resolves committed IndexedDB assets.
- Same-browser JSON import can resolve assets that still exist under their
  stable IDs.
- Different-browser import preserves image items, accessibility data, CTA, and
  clickable-area metadata but reports missing assets for owner replacement.
- JSON backups contain an asset manifest with `assetsIncluded: false` and the
  visible warning defined by `CUSTOM_DESIGN_BACKUP_WARNING`.
- Customer clickable areas never render when their image is missing, their
  action is unresolved/invalid, their label is unconfirmed, or their position
  needs review.
- A resolved asset does not expose customer clickable areas until its actual
  image element fires `load`; an image decode/render error suppresses the link
  layer and reports the stable asset/image IDs for recovery.

## Phase 2 integration requirements

Phase 2 still owns the central section union and commands, Add Section library,
upload/settings UI, image-list reorder/history operations, universal Move and
remove/restore behavior, Preview routing, canonical Booking/Contact resolution,
object URL React ownership, publish readiness, and browser journeys. The real
publish gate must recompute action resolution and asset availability; it must
not trust persisted validation status alone.

Do not import Production upload code into this Lab. Do not add image bytes to
the document as a fallback.
