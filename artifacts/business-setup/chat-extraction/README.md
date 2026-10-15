# Read an owner's image through the conversation

The chat now receives the actual owner-confirmed image/PDF and can extract business facts in the same response. It saves constrained facts as an `import_upload` draft operation with upload provenance, alongside any typed answers, in one revision. No schema migration is required. Prices and durations remain unconfirmed, new addresses remain private, and publishing still uses the existing exact approval gate.

Saved conflicting facts are preserved and called out in chat. Unclear/from/range prices, missing durations, unsupported add-ons, and unreadable information retain the existing extraction boundaries. Tenant ownership and saved image-purpose checks run on the server. Replays reuse the persisted operation; concurrent edits fail rather than overwriting newer state.

The single owner composer now routes both initial setup and existing custom-site edits through conversation. The extra extraction button is removed. Historical Markdown emphasis displays as plain text. Legacy pending upload reviews remain recoverable.

## Verification before hosted trial

- 86 focused tests passed: 55 disposable-PGlite domain/integration, 13 owner UI, 3 timeline, 8 business API, 7 custom-site API.
- Added exact-request and paraphrase cases, image binary forwarding, atomic typed answers plus extraction, duplicate/replay recovery, missing durations, conflicting existing data, malicious output, inspiration ownership, and concurrent edits.
- TypeScript, changed-file ESLint and whitespace checks passed.
- Local Chromium desktop, Chromium mobile and WebKit mobile: one composer, viewport fit, attachments, keyboard focus, preview/details/review. Local model calls disabled.
- Hosted provider trial and deployment evidence are recorded separately after the clean commit is deployed. These deterministic checks do not claim real-provider success.
- Production and published example sites have not been changed.

## First real-provider attempt

Astra read the test menu correctly, but the application rejected nested hours/services arrays because the legacy extractor expected encoded JSON strings. The failed attempt and its charged usage are retained in `first-real-attempt.json`; raw output stays private in the trial ledger. The parser now accepts either representation and applies the same strict field, size, price, duration and hours validation. A temporary read-only replay test against the retained output passed. No draft or live data was manually repaired. A fresh owner-facing trial follows the corrected deployment.

## Successful owner-facing trial

On isolated Preview `5939aa02`, the exact message “Just get all the info from my image” read the uploaded synthetic menu and saved revision 3 in 9 seconds. Astra extracted Aster Nail Studio, Toronto, private home address, opening hours, BIAB CAD65/75 minutes, and Gel manicure CAD50 with its missing duration left unresolved. It asked only solo/team and the missing duration. No extraction or acceptance button was used.

The next chat answer supplied solo/60 minutes and requested a cream website. Astra saved revision 5 with custom source `0f4480ed-3fca-416b-8383-c45068aa2f21` in 64 seconds. Source validation passed first time; there was no manual source editing. Refresh restored the answers, services, source and attachments. The preview displays the real draft. This new synthetic salon remains private/unpublished, with zero live services and appointments. The existing published original-booking journey was checked separately and remains unchanged.

The extraction reply was still repetitive on a phone, so the final UI copy groups the summary and removes duplicate missing-length/add-on notes. The same 85 focused checks passed after this copy adjustment. Final deployment and low-resolution reference trial follow below.

## Supplied low-resolution reference

The actual 137×1280 reference was uploaded in a separate private synthetic salon through the same owner UI. Astra read the business name, flagged unreadable small contact/policy/opening-time text, and identified collapsed category headings rather than inventing service prices or durations. Refresh retained the result. The reference and screenshots remain private; sanitized timing/usage is in `reference-real-provider.json`.

A no-change hours operation initially made the summary say hours were saved even though only an already-closed day was read. The final correction compares weekday intervals semantically (independent of PostgreSQL JSON key ordering), omits that operation and removes the stale attachment hint. The expanded 86-check suite, TypeScript and scoped ESLint pass. Broader CI is not green: the communications PostgreSQL job failed before tests on Docker Hub `toomanyrequests: Data limit exceeded`.
