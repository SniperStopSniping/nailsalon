# Website detail preservation and chat recovery

Application commits: `0c42f687` and `e7f502f8`. Work is on `codex/ai-business-setup`; no production merge, migration, or data change.

## Implemented

- Own-reference extraction includes public directions/intersection, validated Instagram/email/phone, and separately identified website wording/policy sections. These persist in the existing shared website-content draft and publication lifecycle; they do not activate deposits or operational booking rules.
- Model generation receives the saved details. Validation requires actual text bindings for every saved detail/section and contact-link bindings. Missing bindings enter the existing single automatic repair, retaining both provider outputs. This verifies structural coverage, not visual legibility or OCR certainty.
- The isolated renderer creates contact destinations from validated data. Generated arbitrary navigation remains forbidden. Contact tabs have no opener. Preview booking, worker isolation, network restrictions, and original service bindings remain enforced.
- Manual Details controls edit the same content. Publication rechecks coverage and exact revision approval. Private street addresses cannot be inserted into the new public-details fields while hidden.
- Send immediately clears the composer and displays the message/loading state. A disconnected request is reconciled against the saved operation rather than treated as unsent. Polling covers generation/applying stages. Refresh restores pending work. Failed requests offer an explicit retry; known terminal failures require a fresh attempt, while unknown delivery retains the original request identity. No automatic paid retry is made.

## Deterministic verification

139 focused tests across setup persistence, UI, timeline, API routes, custom source validation, renderer frame, website details and content persistence. Nine browser checks across desktop Chromium, mobile Chromium and mobile WebKit cover isolated runtime attacks, preview booking rejection, complete details and clickable contact destinations (external destinations intercepted).

TypeScript, scoped ESLint and diff checks passed. A source-only secret scan passed over 3,954 tracked files before the final wording-only adjustment. The normal scanner could not scan three oversized local development bundles; it reported unscanned files, not a detected credential. Production bundle verification is separate.

## Real provider: supplied Dynasty screenshot

OpenAI Responses, `gpt-6-astra`, through the hosted owner composer. The 279 × 1280 reference was uploaded as an owned design. First request included only essential missing solo/hours/service details plus “Make my booking website from this design”; it did not request complete information or clickable links separately.

- First design: revision 4, artifact `f2abf877-ca0e-4857-8cfe-5a9cbda7b4a2`.
- Follow-up: revision 5, artifact `012d9eab-ecec-48f4-a2c7-b18c38815ce1`.
- Readable intersection, Instagram/email and two content sections were saved and rendered. Instagram anchors had real validated destinations.
- Tiny Deposits/Payments/Guests/Late Arrivals/Squeeze-in paragraphs were explicitly reported unreadable. No claim is made that this image yielded those policy terms.
- The follow-up requested a smaller mobile heading. Its HTTP response was deliberately dropped after server execution. The owner UI recovered the completed result automatically, retained the empty composer and submitted once.
- Four paid calls (two conversation, two generation); both generated outputs passed initial validation. This trial consumed CAD 1.548242 of the conservative ledger allowance. Cumulative allowance after it: CAD 32.266204 / 40, including frozen local usage.
- Two browser harness assertions were corrected (icon text matching, multiple valid Instagram anchors). The existing request was resumed without resubmitting generation. No generated source was edited by a developer.
- Screenshots and reference-bearing evidence are retained privately, not committed. The test salon remains unpublished, with online booking disabled and zero appointments.

The first clear synthetic-reference trial extracted the full details but the conversation model unnecessarily deferred generation until another review. This was a real product failure, not a renderer failure. The follow-up fix makes an explicit first-website request start generation as soon as essentials are present, even if the model omits its design action. Deferred, negative and informational requests are excluded; publishing still requires exact approval. A fresh real-provider trial of that fix is recorded separately after completion. No new end-to-end customer booking or real publication is claimed for these UI/content fixes; isolated publication/idempotency is covered by the deterministic persistence tests.
