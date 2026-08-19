# ADR 0005 — Catalog Revision and Material Fingerprint

**Status:** Accepted (Owner-ratified).

## Context
Two different questions were being conflated: *"did the salon's catalog change?"* and
*"did **this customer's** configuration materially change?"* Only the second should
interrupt someone mid-booking.

## Decision
**Two distinct hashes.**

- **`catalogRevision`** — snapshot-level. Changes when any public semantic
  representation changes. Excludes `generatedAt`, internal rule ids, notes, audit
  metadata, private capability assignment, and irrelevant row ordering.
- **`catalogResolutionFingerprint`** — per resolved selection. This is the value that
  gates the conflict response. Material subset only: `schemaVersion`, `familyId`,
  `selectedVariantId`, add-on lines (`addOnId`, `quantity`, `unitPriceCents`,
  `lineTotalCents`, `unitDurationMinutes`, `lineDurationMinutes`), `autoAdditions`
  (`addOnId`, `reasonCode`), `catalogSubtotalCents`, `totalDurationMinutes`,
  `explicitConfirmationMode`.

**Canonical serialization is synchronous and shared; hashing is SHA-256 and may be
async** — Web Crypto in the browser, `node:crypto` on the server, over byte-identical
canonical input, proven equal by differential test.

**Localized reason text is excluded structurally**: `autoAdditions` carries
`reasonCode` only, so prose has no field to occupy. A language switch cannot read as
"the menu changed".

Material quantity and line-duration changes **are** included.

## Consequences
A non-cryptographic hash is not acceptable here — this value gates a correctness
decision. `Date` values must canonicalize via `toISOString()`; a generic object walk
turns a `Date` into `{}` before `JSON.stringify` can call `toJSON`, silently blinding
the revision to date changes. A legacy NULL confirmation mode stays `null` rather than
normalising to `'instant'`, so it cannot collide with an owner who explicitly chose
instant.
