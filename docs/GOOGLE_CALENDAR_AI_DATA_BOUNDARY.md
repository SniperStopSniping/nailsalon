# Google Calendar and AI data boundary

## Approval boundary

This work is preview-only. Do not merge, release to production, reply to Google, delete historical records, or describe the app as Google-compliant without the user's approval. PR #469 is a held disclosure-only change; its passing checks do not establish a data boundary or Google approval. The AI phone receptionist is retired by the user's explicit instruction.

## Observed baseline, October 20, 2026

- At the start of the audit, public health returned HTTP 200, `ok`, commit `21eb289`, schema `ready`. Vercel resolved the public domain to `dpl_8uajzSjcTrgLPXKf6L2zxkhE6SnP`, full SHA `21eb289cd73b38b066a9592c390012a7b27609ac`.
- The starting source main matched that commit. A later fetch found release-metadata-only commit `8ffdfc7c` (package version/changelog/lockfile version); no application-source changes. It includes release PR #461 and candidate `5a5dbec3`. Other release/configuration work remains owned by its existing task.
- A later public health refresh returned `8ffdfc7`, `ok`, schema `ready`; that separately owned release contains only version metadata beyond the starting application source. This task made no production deployment.
- PR #469 is OPEN/DRAFT at `99101435ef6ad0ee09238efe5d369d548968f3ab`. Its preview `dpl_978NiX3sUxHmxcNdvcih9jwsdLgs` is READY. It is not merged or publicly serving.
- The public privacy policy contains the original data-protection section, but not #469's optional-AI disclosure. No Google email has been sent by this task.
- Production configuration still contains legacy voice switches. Their presence is not proof of active phone routing, enabled salons, calls, or browser usage. Neither this task nor the release coordinator established active voice usage. No live customer content or credentials were inspected to infer usage.

## Baseline source trace

| Path | Boundary found |
| --- | --- |
| Customer `turn.server.ts` | Serialized `bookingState`, `availabilitySearch`, display dialogue, and legacy message history before calling OpenAI. |
| Customer `reply.ts` / `receptionistTurn.ts` | Luster inserts calculated availability and offer wording after interpretation. The resulting display text was subsequently saved in dialogue and replayed on later turns. |
| Customer normal booking | The handoff leads to server-owned time selection, contact, prepare, confirmation, and status routes. These authorities already enforce conflict checking and booking serialization. |
| Owner tools | `diagnose_day_availability` can return calculated slot counts, reasons and first openings. Configuration previously excluded it, but the implementation could be re-enabled. Overview/readiness also contained Calendar connection status. |
| Owner history | Signed windows contain prior assistant text, which may reflect earlier Calendar-grounded tool results. Removing a tool alone does not remove that replay path. |
| Phone/browser voice | `authority.server.ts` includes offered slots in interpreter context and a dynamic response-schema enum. `coordinator.server.ts` sends structured results, review/status wording, and saved call context to the live OpenAI session. |
| Storage/logging | Customer replay and signed display windows, voice drafts/summaries, and provider records can outlive one request. Usage ledgers and sideband diagnostics use bounded metrics/codes; existing provider retention is separate from `store: false`. |

## Separation being verified

The model interprets user-entered preferences and uses the public service catalogue. Luster calculates and renders availability after the model response. Calendar events, busy windows, derived openings, availability search summaries, selected appointment times, receipts and confirmations remain in the booking/display path.

Customer model history is a separate signed field containing user input and the model's own wording before Luster substitutes server facts. Legacy display history is not promoted into it. Model service context is maintained independently from scheduling context. Actual time buttons, selections and confirmation remain in the ordinary booking form. Calendar checks and transaction protections are preserved.

Owner availability diagnostics are unavailable to the model regardless of rollout configuration. Calendar connection status is omitted from the model's overview/readiness results. Legacy owner model windows restart without replaying earlier answers.

Voice activation, direct consultation, provider requests and sideband coordination are fenced in source, and its settings become historical/read-only. Existing deterministic booking reconciliation remains independent of AI session creation. No historical conversation, call, appointment or provider record is erased by this change.

## Required evidence before review

- [x] Capture actual fake-data model requests, including follow-ups, legacy history, completed-turn replay, retries and errors.
- [x] Change fake Google conflicts and verify that Luster's displayed openings change while model-bound content stays independent of those results.
- [x] Exercise normal selection, review, confirmation and lost-response recovery through real handlers on an attested disposable database; confirm no additional model call receives those steps.
- [x] Exercise enabled owner tools and direct attempts to invoke the blocked Calendar tool.
- [x] Verify retired phone/browser entry points cannot create a provider session, including with old switches enabled.
- [ ] Verify disclosure wording and phone-history UI in preview, and record the exact tested commit.

## Synthetic evidence collected

- Customer actual provider requests: changing private slots from `2026-09-20T19:00:00.000Z` to `2026-09-20T20:00:00.000Z` changed displayed results while the initial and follow-up model requests were byte-for-byte equivalent as objects. Legacy Calendar/display/receipt canaries were absent. Completed-turn replay made no model call; private errors did not enter a retry request.
- Owner actual provider requests: both rounds across all four enabled tools were identical with Google readiness `not_connected` versus `ready`. A fifth attempted Calendar diagnostic was denied with `tool_not_enabled`. Calendar account/error canaries and connection-status fields were absent. Legacy owner turns were not replayed.
- Four real-handler PostgreSQL browser journeys: Chromium and WebKit, each with legacy and L1 catalogues. A one-hour fake Google conflict reduced available slots from **92 to 88**, and the blocked time button disappeared. Selection, contact, review, confirmation and recovery from a deliberately lost confirmation response produced exactly **one appointment and one earlier service-guidance model call** per journey. No selected/confirmed timestamp or entered contact reached that call.
- All **62** PostgreSQL booking authority/concurrency cases passed, including same-slot contenders, duplicate confirmation, serializable retries and a fake Google conflict introduced after review. That late conflict returned **409** and created **zero appointments**.
- Voice tests verify that old phone/browser switches cannot create a runtime config, a stale config cannot make a provider request, and sideband coordination returns before storage, consultation or WebSocket attachment. Historical coordinator protocol tests retain an explicit test-only retirement override; this does not enable production voice.

Full intercepted requests and evidence hashes are retained outside the checkout in the task's `google-calendar-ai-separation` evidence directory and linked from the review. They contain synthetic fixtures only. Payload tests capture the complete provider request, including its prompt, context and response schema; they do not call OpenAI or Google. The full browser/transaction journeys use a separately owned, loopback-only PostgreSQL 16 cluster attested by the existing disposable-target guard.

Usage ledgers store token/cost/timing metrics and bounded outcome/tool codes, not prompts or appointment details. The custom OpenAI adapter does not log request/response content and discards provider error bodies. Sentry's existing assistant/booking hooks remove request bodies, cookies and bearer state; these were source- and unit-checked, not an inspection of historical hosted telemetry. No historical provider log or customer record was read or deleted.

## Remaining limits and policy questions

Customers or owners can independently type or paste scheduling information into a message. The application cannot reliably determine its origin or promise perfect filtering of arbitrary text. The boundary excludes application-controlled Calendar state; it is not a claim that all possible user messages are free of Google information.

Historical client windows, stored call records, provider security logs or previous live-session records may retain earlier data. A new boundary does not erase them. Any deletion or active-session/provider cleanup requires separate approval and verified retention behavior.

Google's [AI/ML FAQ](https://support.google.com/cloud/answer/13463817?hl=en) distinguishes personalized-model use and storage restrictions from training alone. The [Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) also applies Limited Use to derived data. [OpenAI's data controls](https://developers.openai.com/api/docs/guides/your-data) distinguish application state from other retention. These documents do not, by themselves, establish that this particular app is compliant or that OpenAI is categorically prohibited. Google/provider interpretation remains unresolved.

## Rollback and cutover

No database migration is planned. Existing appointment and conflict authorities remain unchanged. Before a production cutover, obtain approval, recheck any external phone forwarding and active live sessions, and verify the public runtime against the approved SHA. Retiring source entry points does not revoke a previously issued provider session retroactively.

The safe operational fallback is to disable AI entry points while preserving ordinary booking and Calendar conflict checks. Reverting the entire boundary would restore the old data paths and voice behavior; it requires explicit approval, not an automatic rollback. Legacy signed windows may need a new chat session after a rollback. Historical records remain intact.
