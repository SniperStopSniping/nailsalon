# Read an owner's image through the conversation

The chat now receives the actual owner-confirmed image/PDF and can extract business facts in the same response. It saves constrained facts as an `import_upload` draft operation with upload provenance, alongside any typed answers, in one revision. No schema migration is required. Prices and durations remain unconfirmed, new addresses remain private, and publishing still uses the existing exact approval gate.

Saved conflicting facts are preserved and called out in chat. Unclear/from/range prices, missing durations, unsupported add-ons, and unreadable information retain the existing extraction boundaries. Tenant ownership and saved image-purpose checks run on the server. Replays reuse the persisted operation; concurrent edits fail rather than overwriting newer state.

The single owner composer now routes both initial setup and existing custom-site edits through conversation. The extra extraction button is removed. Historical Markdown emphasis displays as plain text. Legacy pending upload reviews remain recoverable.

## Verification before hosted trial

- 85 focused tests passed: 54 disposable-PGlite domain/integration, 13 owner UI, 3 timeline, 8 business API, 7 custom-site API.
- Added exact-request and paraphrase cases, image binary forwarding, atomic typed answers plus extraction, duplicate/replay recovery, missing durations, conflicting existing data, malicious output, inspiration ownership, and concurrent edits.
- TypeScript, changed-file ESLint and whitespace checks passed.
- Local Chromium desktop, Chromium mobile and WebKit mobile: one composer, viewport fit, attachments, keyboard focus, preview/details/review. Local model calls disabled.
- Hosted provider trial and deployment evidence are recorded separately after the clean commit is deployed. These deterministic checks do not claim real-provider success.
- Production and published example sites have not been changed.

## First real-provider attempt

Astra read the test menu correctly, but the application rejected nested hours/services arrays because the legacy extractor expected encoded JSON strings. The failed attempt and its charged usage are retained in `first-real-attempt.json`; raw output stays private in the trial ledger. The parser now accepts either representation and applies the same strict field, size, price, duration and hours validation. A temporary read-only replay test against the retained output passed. No draft or live data was manually repaired. A fresh owner-facing trial follows the corrected deployment.
