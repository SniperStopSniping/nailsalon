# Custom Design

This directory contains the model, Lab-only asset storage, customer renderer,
and owner-editing infrastructure for the universal Custom Design section. The
Site Builder shell integrates these modules through the central document,
history, Preview, Move, visibility, and remove/restore systems.

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
3. prepare one validated universal history command without publishing it;
4. commit the staged assets in one IndexedDB transaction only after command
   preparation succeeds;
5. publish the prepared history transition once, using a baseline comparison so
   it cannot overwrite a newer owner action;
6. delete newly committed assets if publication fails and no current,
   removed, past, or future history snapshot references them.

Keeping the prepared transition private until its asset commit completes avoids
persisting or rendering a document that points at a staged, unreadable blob.

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

## Integration boundary

`integration/` coordinates upload transactions, owner settings, image
management, accessible text, hotspot sessions, and customer readiness. The
universal Builder remains authoritative for section visibility, selection,
history, Move, Pages & Structure, remove/restore, import/export, and canonical
Booking navigation. Readiness is exposed at section level because this Lab has
no Production publish system; a future publish gate must recompute action
resolution and asset availability rather than trust persisted validation
status alone.

Do not import Production upload code into this Lab. Do not add image bytes to
the document as a fallback.
