# Customer receptionist correction and latency evidence

Source baseline: `952dadc23bace8ff0f43e7158e1eef02efec39c8` (current remote main at investigation).

## Root causes

The three welcome labels all called `send(reply, 'quick_reply')`, which posted to the model-backed chat route. There was no deterministic booking navigation handler. Live Book reproduced the chosen-label bubble followed by the generic unavailable response and no navigation. The baseline route catches several model/resolution failures as the same message; its existing public telemetry cannot identify the particular swallowed exception for that live request.

Unsupported treatments became `unavailable` results. The composer had to include the generic limitation sentence verbatim, its fallback returned that sentence, and unavailable results did not retain or render service options. The old fixed treatment state also could not represent hard gel or arbitrary unsupported designs independently. These combined to prevent useful recovery even when a supported alternative existed.

## Correction

Welcome actions have stable identities. Booking navigates to normal tenant service selection; prices load the current public price catalogue; consultation begins with a local welcome question. None sends the welcome label to GPT. Normal typed input remains conversational.

One Terra call now understands the request and supplies candidate conversational wording. Luster resolves selection, compatibility and facts, then validates the candidate and substitutes authoritative fact references. Packages, required questions, and availability use their resolved server presentation. Missing facts or incompatible candidate output fall back without publishing speculative promises. General nail knowledge may explain differences and suggest relevant listed services or compatible add-ons; it cannot create catalogue items, quote invented values, claim retail stock, or add an upsell without customer acceptance.

A bounded unsupported-request label survives informational detours and unrelated preference changes. Explicit resolution is separate from a recommendation. Treatment, design, and removal blockers have distinct clearing checks. An accepted new set cannot erase unsupported removal. Prices and recommendations never create booking authority.

## Latency and cost measurement

`Server-Timing` exposes aggregate durations only: setup, initial catalogue/context load, the combined model call, server resolution (excluding nested availability), availability, reply validation/rendering, persistence and total route time. It contains no customer identities, messages, tokens, salon risk or internal resource identifiers. Browser/network time must be measured separately; a spinner does not count as a useful response. The usage ledger captures model usage and the timings available before the final ledger/revision/replay writes; only the route timing covers final persistence and total elapsed processing.

Initial context reads run in parallel. The clarification snapshot is reused only within a turn. Quote and the before/after availability checks retain their fresh reads. There is no cross-request catalogue or availability cache. The bounded single-model output/schema is included in spend reservation, and missing provider usage stays unknown.

The baseline live public endpoint exposed no stage timing or token/cost values. Live observations therefore report only fetch-to-parsed-response time and explicitly exclude rendering. Rate-limited samples are reported separately from ordinary-turn latency. The production deployment observed before this change was `dpl_VSeJuHaANsHHiW6UeNAg3W5sJz9e`; its inspected metadata/health response did not expose a commit SHA, so the live observations are not claimed to prove that deployment's source revision.

Real-provider comparative benchmarks use an identical synthetic L1 catalogue/resolver/schedule for both architectures. Their model-stage timing and provider token usage are real; their local resolver timing is not a measurement of production database or calendar latency. Raw observations and sample sizes accompany the performance report. The in-repository paired reports are investigation checkpoints, including failures that drove the blank-segment, deferred-question and compatible-recommendation corrections; they are not the final release result. Final frozen-code and live results are recorded with the task release evidence.

## Preserved boundaries

No changes to network no-show scoring, recording, activation, deposit resolution, prepareQuote, availability validation, appointment creation, durable booking recovery, SMS, Client Profile, or billing activation. Network risk never enters model context. No migrations or voice work. Public live verification must stop before creating an appointment, payment or provider message; destructive tests use isolated synthetic fixtures.

## Verification status

Local checks completed before PR:

- Customer AI unit/component/route coverage before the final recommendation guard: 454 passed, 20 intentionally gated tests skipped.
- Final changed core after recommendation/formatting corrections: 76 passed.
- Appointment regression suite: 119 passed.
- Rendered component-browser matrix: 34 passed across Chromium and mobile WebKit, including 320 px / 200% text, deterministic welcome actions and normal handoff/recovery.
- Type check, production build, changed-source lint and generated-client/tree secret scan passed. Lint retained ten existing warnings in unrelated booking/admin components.
- Full local suite: 10,983 passed; one unchanged database-marker test hit its five-second timeout under load. That complete 38-test file passed on isolated rerun, without changing timeouts. Required full CI remains the final gate.
- Independent authority review approved the one-call protocol, unsupported-request persistence, fresh conditional fact reads, tenant-scoped prices route and final formatting/recommendation deltas. Network no-show, deposit, prepareQuote and fresh availability modules have no diff.

Before release, require exact-head CI, preview checks and rendered live retesting. Local component-browser fixtures prove interaction and layout; they do not substitute for live catalogue/model checks. The final task report records the released SHA and any remaining verification limits.

## Live catalogue follow-up

The first release's rendered welcome actions passed, but the first typed turn failed before a model call. Reproducing the ordinary public Isla catalogue (11 services, 13 add-ons, 52 bindings) produced a minimum 40,864-byte combined prompt, exceeding the 40,000-byte cap even before salon profile facts. The original synthetic fixtures used shorter IDs and missed this case.

The model-only binding table now uses explicit zero-based indexes into canonical service/add-on ID dictionaries. Every binding, order, duplicate, required flag and quantity is preserved; output IDs and server validation still use the original canonical catalogue. Isla's binding projection shrinks from 7,004 to 2,264 bytes. The full minimum input, including the added dictionary instructions, is 36,362 bytes.

The input cap is 64,000 bytes to accommodate public profile facts and populated Unicode dialogue; the schema/output-aware spend reservation derives from that cap. This is a ceiling, not padding or extra model work on ordinary turns. Oversized inputs still fail closed without pruning catalogue authority. Regression coverage includes realistic opaque IDs, full consultation state, Unicode history, and exact binding round trips. The paired benchmark keeps the archived baseline projection and refuses to call the provider for an oversized context.
