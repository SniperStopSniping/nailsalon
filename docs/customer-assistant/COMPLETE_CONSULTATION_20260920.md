# Complete customer consultation

## Release baseline and protected behavior

Started from protected main 8b64ed6c (1.126.1), including Client Profile #284 and operational SMS #285. Those projects are complete, not parallel workstreams. No owner profile, SMS rendering/credits/suppression, salon catalogue/configuration, payment engine or billing activation change is part of this correction. The established Terra interpreter/Luna reply composer and store:false policy remain.

## Diagnosis

Live Isla reproduction: requesting Gel Manicure, selecting Nothing, then asking for extensions produced a base Gel-X proposal while prose described optional lengths. There were no length controls before Choose these services. The code accepted catalogue validity as consultation completeness: unknown length/design did not block selection, model propose skipped optional questions, and handoff checked only the current quote fingerprint. The generic greeting and repeated financial qualification also came from server/application copy.

## Boundary

Consultation assessment is separate from manual catalogue requirements. It checks current-product/removal transitions, required options, meaningful lengths, explicitly requested extras/quantities and a handled optional design opportunity. Plain and skip are valid decisions. Informational prices and hypothetical comparisons do not commit selections. Compatible preferences survive service switches; incompatible inherited selections are removed and timing/proposal authority is invalidated.

Choices and comparisons resolve complete alternatives through L1. Base/no-upgrade is an explicit option only when the base resolves; it is never labelled Short without authoritative public evidence. Included choices need no fabricated paid ID. Physical lengths may be service variants. Service duration excludes booking buffers. When only the optional design offer remains, a read-only quote can answer the known configuration’s price/duration as “Selected so far”; it does not create proposal acceptance authority. Missing length, product, removal or required options cannot use that path.

The customer-only Redis revision record binds the latest completed signed conversation and fences in-flight edits. Handoff rechecks current consultation/catalogue authority then checks the revision after asynchronous reads. The same completed revision can retry; historical signed tokens and unavailable revision authority cannot issue a handoff. Older conversations without revision evidence must start a fresh conversation; manual booking remains available. No new appointment creation path is introduced.

## Conversation and handoff

Welcome is deterministic and uses the trusted route-resolved public salon name. Existing conversation persistence prevents duplicate welcomes on reopening; Start over creates fresh state. Structured priced choices are shortcuts alongside ordinary typing. The final package has a short conversational lead-in and one authoritative breakdown.

The journey remains consultation → Choose these services → normal Time → Details/reminders → Confirm. Recovery/idempotency and deposit/payment semantics remain owned by the existing booking flow.

## Verification contract

Focused semantic, acceptance, UI and real Redis tests cover incomplete/stale proposals, paid-extra intent, preserved facts, variant/included lengths and concurrent edits. Existing real PostgreSQL operation/creation races and backend mobile handoff journeys remain required exact-head CI gates. Component browser coverage includes Chromium/WebKit, narrow viewports, enlarged text, focus and priced controls. Synthetic real-model reports retain full transcripts, model usage, latency and semantic review findings.

No claim of release or live acceptance is made by this implementation document. Exact final-head checks, deployment SHA, repeated evaluation and final-release live matrix must be recorded in delivery evidence after execution. Live tests stop before appointment creation, messages or payments.
