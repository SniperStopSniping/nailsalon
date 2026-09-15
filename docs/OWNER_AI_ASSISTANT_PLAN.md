# Luster Owner AI Assistant — first-release plan

Planning baseline prepared September 14, 2026 against fetched origin/main `5779b937d629a6ae58d123eac16948e57a740427`. This durable copy records the proposed roadmap; implementation status is distinguished below. Estimates and future phases are not claims of shipped capability.

## Authorized first implementation

The owner authorized one bounded slice after this plan: salon-aware menu ordering through request, exact preview, Apply, transactional receipt and guarded undo, with the minimum chat/action-card UI to test it. Implementation belongs in the isolated `feat/owner-assistant-menu-order` checkout. It must remain disabled by default, use no paid model/provider provisioning, make no production changes, and stop at a review-ready PR. No merge or live-owner activation is authorized. Stripe, CI and release work are excluded.

The first request interpreter is intentionally bounded and deterministic: named-service ordering requests plus explicit selections. It is not a general language model and must not claim arbitrary AI capabilities. Price editing, website copy and client intervals remain future proposals. Validation evidence and remaining limitations are recorded in `OWNER_AI_MENU_ORDER_VALIDATION.md` when available.

### Implemented slice contract

- The owner opens **Menu assistant**, enters `Move Nail art before Gel manicure` (or `after`), and resolves unknown/duplicate names with explicit selection. Only that salon's complete Services menu is considered, including inactive services.
- The server creates a durable proposal with the exact before/after order. Preview creates no service changes. The card explains that customer booking-page groups and featured priority still apply. Applying changes only service `sortOrder` and normal `updatedAt` metadata; prices, durations, category, activation, service relationships and appointments stay untouched.
- Apply uses the proposal ID as its idempotency handle. The receipt commits in the same transaction as the ordering changes. A lost response is recovered by reading that same operation. Repeated Apply/Undo does not create another mutation.
- The implementation uses a **15-minute proposal expiry** (superseding the earlier 10-minute proposal below), a trigger-maintained revision across all service writes, and exact snapshot checks. Any intervening service change invalidates Apply or Undo, including a change later reverted to its original value. A no-op preserves existing numeric/null ranks.
- Undo restores the exact original ranks only while the committed result is still current. The Undo button is explicit confirmation of that bounded inverse; it does not rewind unrelated history. Local owner membership is rechecked under a transaction lock; initial identity/session admission remains the application's current auth boundary.
- This first slice has no model API calls, paid service dependencies, feedback ingestion, setup automation, appointment operations or customer assistant. The broader roadmap below remains proposed work, not part of this PR. Closing/reopening the panel preserves its current receipt within the mounted dashboard; cross-reload history is deferred.

The new migration and existing schema safeguards need separate review before any deployment migration. The default-off Services editor continues to work against the pre-migration schema. See the validation record for exact test and hosted-check outcomes.

### Later read-only diagnosis: “Why can’t clients book Friday?”

Record this as a later read-only workflow, not a dependency of menu ordering. Resolve which Friday in the salon timezone, location, selected services/add-ons and technician (or any technician); ask for missing inputs instead of guessing. Read only the authenticated salon's permitted configuration and scoped availability results.

Reuse `src/app/api/appointments/availability/route.ts` and its existing `validatePublicBookingSelection`, `loadBookingPolicy`, `canTechnicianTakeAppointment`, `resolveBookingHoursCeiling`, Google busy-window and timezone helpers. If explanatory reason codes are needed, extract them from those same decisions; do not duplicate slot generation or build another scheduling engine.

Show the checked date/timezone/selection and an evidence-based explanation such as closed hours, insufficient duration including buffers, minimum notice, incompatible service/technician, existing conflict, or unavailable calendar-provider data. An unavailable provider is “could not verify,” not “fully booked.” Do not expose other clients' names, appointment details or calendar event descriptions. Link to the relevant existing editor, without changing hours, appointments, services or integration settings. Repeated diagnosis refreshes the snapshot; no Apply or undo is needed. A suggested opening is not reserved, and the normal booking path must revalidate it. Future tests must prove parity with the canonical availability result, timezone/DST and next-Friday handling, wrong-tenant rejection and honest partial-failure states.

## Recommendation and corrections

Ship an owner-only, actions-first pilot with four bounded actions: set explicit service prices, reorder existing services, save public-page copy as a draft, and update one client's return interval. Provide setup guidance, navigation and structured feedback alongside them. Keep the customer booking helper for a later release.

Challenge the earlier proposal:

- A help-only launch would not test the central promise: completing work. Internal staged PRs may be read-only initially, but the external V1 pilot must include actions.
- A floating chat button is not a substitute for fixing a confusing calendar or rebooking flow. Keep the ordinary editors available and improve them independently.
- Adding services automatically is not a cheap reversible action in the inspected code. Creation/template paths can activate services and attach related records; safe removal may be destructive. Defer creation and rule changes.
- Price editing is not simply exposing the existing PATCH route. That route expects a broad form and applies defaults to unrelated fields. A safe price-only operation and transactional conflict checks are genuine work.
- Consultation confirmation mode is explicitly rejected as not yet available. Do not promise that a customer helper can book a consultation today.
- Existing rebooking prefill carries client contact, base service and technician, not every previous add-on. “Book the same set” is an extension to validate, not an already-complete capability.
- No new standalone agent platform is needed for this existing Next.js app. Keep orchestration short and server-side; no background autonomous agent, arbitrary SQL, shell, browser automation or external connector tools.

## Evidence from current main

All paths below refer to the pinned main commit, not the older local checkout. Browse at https://github.com/SniperStopSniping/nailsalon/tree/5779b937d629a6ae58d123eac16948e57a740427 .

| Capability | Existing source | Genuine gap for this release |
|---|---|---|
| Service editing | `src/app/api/salon/services/[id]/route.ts`, schema around line 39 | Broad form save; introduce a narrow price command using shared validation, permission checks and transaction-safe stale-state detection |
| Menu ordering | `src/app/api/salon/services/route.ts`, PATCH around line 426 | Ownership/duplicate-ID checks and transactional order writes exist; add full-menu completeness, preview freshness and operation receipts |
| Website copy drafts | `src/app/api/admin/booking-page/route.ts`; `src/libs/bookingPageContent.ts:226,349,510` | Existing content-draft validation and transaction helper; add limited text-field adapter and concurrency/undo envelope |
| Client return interval | `src/app/api/admin/clients/[id]/route.ts:133,152,1422,1446` | Existing 1–365 day validation, expectedUpdatedAt and derived due-date update; reuse via a narrow shared command and minimized read projection |
| Ownership | `src/libs/adminAuth.ts`, owner check around 470–501, salon guards around 756 | Bind assistant requests to authenticated active salon, owner permission and action-specific checks at every step |
| Today appointment navigation | `src/app/[locale]/admin/page.tsx:2030` | Already passes the exact appointment ID. Measure/preserve the handoff rather than claim direct opening is missing |
| Owner calendar | `src/components/admin/ScheduleCalendarModal.tsx:734` | Initializes monthly; add preference persistence and reliable return context |
| Rebooking | `src/hooks/useAppointmentActions.ts:24,474` | Existing prefill is limited; make selected-service/add-on handling explicit |
| Setup | `src/components/admin/onboarding/OnboardingWorkspaceHandoff.tsx:236` | Existing readiness/publish checklist; clearer required/optional distinctions and focused preview validation |
| Assistant/feedback | Targeted API inspection | No dedicated owner action-assistant or structured product-feedback endpoint identified; not an exhaustive absence audit |

No Stripe or billing implementation inspection was needed for this revision. No production readiness claim follows from source inspection.

## Shared interaction and execution contract

Desktop launcher: bottom right. Mobile: above navigation/safe area, never covering appointment controls; opens a sheet with keyboard-safe scrolling. Four action shortcuts plus “Finish setup,” “Find a setting,” and “Give feedback.” Each screen can offer a contextual “Ask about this” entry without automatically uploading the screen or its client data.

Common flow: ask/tap → resolve ambiguity → server prepares a typed proposal → editable review card → explicit Apply → authoritative receipt and link to affected screen. The model proposes; the server validates and executes. No automatic confirmation inferred from chat text, stored instructions or model output.

Each mutating proposal is bound to actor, authenticated salon, action type, target IDs, exact field changes and relevant version/fingerprint. Proposed expiry: 10 minutes. Any edited proposal invalidates the earlier confirmation. Switching salon, logging out, permission loss or expiration requires a new preview. A client-supplied salon slug is only a checked hint.

Introduce a small operation record with prepared/applied/rejected/reversed states and before/after values limited to allowed fields. Record writes and operation receipt atomically with the business mutation. Extract transaction-aware application helpers where existing HTTP handlers own the transaction; do not create a separate AI validation implementation or make a successful HTTP call followed by an unrelated receipt write.

Success comes from a committed receipt, not generated prose. A failed validation or stale preview changes nothing and offers a refreshed proposal. For timeouts, show “Checking whether this saved”; query the same operation rather than submitting a new mutation. If status cannot be established, keep it unresolved and retain the operation ID.

Double taps/retries reuse the same operation ID. Repeating a natural-language request with a new ID checks current desired state and can return “Already set” without a write. No global deduplication that suppresses intentional later edits.

Undo is a new reviewed inverse operation, not database history rewind. It must verify the original result is still current, use normal validation/permissions, and refuse to overwrite later edits. Relevant intervening events invalidate undo even if a value happens to return to its previous value. Undo itself is idempotent. Audit history remains.

Owner-only pilot, excluding staff, collaborator escalation and super-admin impersonation sessions. Reuse the existing owner guard and each application's narrower rules; do not treat general admin membership as ownership. Salon/client IDs, cached context, receipts and feedback remain tenant scoped. Stored text and chat content are untrusted data, never instructions granting tools or permissions.

## Four V1 action workflows

### A. Set specified service prices — highest-value action

- Ask/tap: “Make gel manicures $50 and builder-gel refills $65,” or tap Update prices and enter values. Maximum five existing simple services per proposal. Explicit amounts only; no automatic market pricing, percentage-wide increases, variant families or introductory-price edits in V1.
- Read: matching salon service IDs/names, currency, current prices, state and versions, plus minimum fields needed to detect unsupported variants/special pricing. Do not load appointment histories, bank details or client records.
- Confirm: exact old/new prices and currency, matched service names, effective behavior (“menu prices change now for new selections”), and count of services. Ambiguous names require selection; mixed/unknown currency is rejected. No invented prices or implied time changes.
- Change: only the approved price fields and ordinary metadata. Existing appointments/payment records, durations, images, descriptions, staff assignments, add-ons and activation state remain untouched. Acceptance must verify that current booking snapshot/revalidation behavior makes this claim true before enabling the action.
- Success/failure/duplicates: all approved prices and receipt commit together, or none do. A concurrent UI edit invalidates the preview. Repeated operation returns its receipt; already-equal prices are no-ops.
- Undo: restore only those prices if relevant records have not changed since. Bookings placed during the changed-price period are not repriced by undo; explain this before applying the inverse.
- Reuse/dependency: factor existing service validation/write behavior into a narrow shared command; the broad existing form payload must not be generated by the model. Add atomic multi-service support rather than looping independent PATCH requests. Fail closed for catalog types not covered by tests.

### B. Reorder the existing menu

- Ask/tap: “Put gel manicures before pedicures,” or tap Organize menu.
- Read: complete scoped menu IDs/order plus current public grouping and featured behavior. No client data.
- Confirm: rendered before/after list, with unchanged groups clearly shown. If grouping/featured settings prevent the requested visual result, explain and open the normal layout editor rather than changing those settings implicitly.
- Change: sort order only, using the existing transactional reorder path. No prices, category membership, featured flags, service activation, durations or appointments change.
- Success/failure/duplicates: server requires a full permutation of the relevant menu, no omissions or duplicates, correct ownership and fresh membership/order. A service added/removed meanwhile requires a refreshed proposal. Same operation returns the saved order; already-matching order is a no-op.
- Undo: restore the prior order only if menu membership and ordering have not changed since this action; otherwise show the current menu for manual review.
- Reuse/dependency: existing PATCH validates duplicate IDs and ownership and writes within a transaction. Add missing completeness and concurrency guarantees in the common application command, including the ordinary editor where necessary.

### C. Write and save booking-page copy as a draft

- Ask/tap: “Write a short intro saying I specialize in natural nails,” or tap Improve my page text.
- Read: salon name, chosen service names and existing draft/live `specialtyLine` and `bio`. Ask for any missing factual claims; do not infer qualifications, guarantees or experience. V1 accepts text, not uploaded files/images.
- Confirm: editable proposed wording, field-level before/after, and prominent “Save draft — customers will not see this yet.”
- Change: only approved draft specialtyLine/bio fields and draft lifecycle metadata through the existing route/helper. Published text, layout, location privacy, images, policies and other unsaved draft edits remain untouched. Never expose publish or whole-page revert as assistant tools.
- Success/failure/duplicates: receipt says Saved draft and links to existing Review & publish. Stale draft fields or concurrent publishing cause refresh; validation failure preserves all content. Same request returns the receipt; identical draft is a no-op.
- Undo: restore only the assistant's text fields if unchanged and not published since the action. If publication occurred, automatic undo stops and opens the existing editor; it must not imply the public page was rolled back.
- Reuse/dependency: content patch schema and transaction helper already exist. Add a strict text-field allowlist, lifecycle-aware fingerprint and operation receipt. Reuse the same save hooks as the existing page to preserve lifecycle behavior.

### D. Change one client's return interval

- Ask/tap: from the selected client, “Set her return interval to four weeks,” or tap Set return interval. From general chat, require an explicit client selection rather than guessing among names.
- Read: selected client ID, display identity rendered by the app, current override, applicable salon default, last visit, due date and version. The model needs only the interval intent; names/contact details and financial history need not enter its context.
- Confirm: selected client, old interval → 28 days, and resulting due date calculated by existing domain logic—or a clear explanation if there is no previous visit. Explain any effect on due-to-return lists.
- Change: that client's interval and its normally derived nextRebookDueAt/metadata. No appointments are made or moved, no outreach is sent, no salon-wide interval changes, and contact/notes/payment fields stay untouched.
- Success/failure/duplicates: preserve expectedUpdatedAt validation and transaction. Concurrent client changes require refreshed confirmation. Duplicate operation returns receipt; already-equal interval is a no-op.
- Undo: restore previous override through normal logic only if the client version and relevant visit history have not changed. Recompute dependent due state; never blindly restore a stale due date.
- Reuse/dependency: existing versioned client PATCH behavior. Extract minimal shared read/write helpers so the assistant does not ingest the full client profile response.

## Setup, navigation and feedback workflows

### Setup help

Ask “Help me finish setup.” Read existing setup/handoff status and minimal relevant service/draft information. Show completed, required and optional steps, with a direct editor link or one of the four action cards. Do not request confirmation for inspection. No settings change until the relevant action's review is applied. Do not publish, create a test appointment, probe providers or mark a setup step complete just because chat ran. On read failure show Unavailable and Retry. Repeated reads refresh state; no mutation or undo is needed. Back returns to the original screen.

### Navigation

Ask “Where do I change my hours?” or tap a shortcut. Read the current salon, permitted destinations and screen context; generate links from a fixed route registry, never model-provided URLs. Show Open working hours, then navigate on tap. No business data changes; denied/missing targets show an explanation. Repeated taps are harmless. Back restores prior non-sensitive navigation state. Navigating to an excluded feature does not authorize an assistant action there.

### Structured feedback

Tap “This was confusing” from chat or any relevant screen. Draft: screen, intended task, category (confusing/bug/missing feature), owner text, optional action ID/outcome, and optional consent to follow-up. Show exactly what will be shared and allow editing. No screenshots, full chat transcript or client details attached by default.

Confirm Submit feedback. Create a tenant-scoped internal feedback record and receipt ID; no salon settings change. Failure retains the draft. Retry uses the same submission ID; separate reports from different owners remain separate evidence. Offer Withdraw to hide/mark withdrawn from triage and stop follow-up; do not promise already-viewed content was never seen. Retention/deletion follows the chosen policy.

Pilot triage needs only a small restricted list with category/status, not a second AI analytics product. Review weekly: frequency across distinct owners, severity and observed task failures. A report is evidence, not an automatic product requirement. Publish status updates only through a deliberately chosen process; this plan authorizes no messages.

## Direct UI fixes, ranked independently

| Rank | Fix | First slice / acceptance | Effort |
|---|---|---|---|
| 1 | Calendar remembers context | Save weekly/monthly choice and non-sensitive filters per owner/salon; restore date after appointment detail; switching salons cannot leak state. Keep monthly available; test weekly as new-owner default rather than forcing it. | 1–2 days |
| 2 | Rebooking clarity | Existing Rebook clearly opens a new-booking form with client/base service/tech. Review current price/availability and show that prior extras are not yet copied. Do not label this “same set” until extras/variants are faithfully revalidated. No silent booking. | 2–3 days |
| 3 | Setup readiness clarity | Improve existing checklist: required vs optional, one next step, draft vs live and customer preview. No extra checklist and no compulsory Calendar/payments connection. | 1–2 days |
| 4 | Today detail handoff | Preserve existing appointment-ID deep link and back/scroll state; resolve any reproduced blank/wrong-detail handoff. Do not redesign Today or add a duplicate action center without observing a failure. | 1–2 days |

These remain useful without AI and should not be gated by assistant availability or usage limits. Extending rebook to copy all compatible add-ons is a later 3–5+ day slice with booking validation and mobile regression tests.

## Proposed PR-sized phases — planning only

Each number is a future bounded change, not a PR created in this task. Estimates include focused tests/review; no claim that all work is trivial because endpoints exist.

| Phase | Deliverable | Dependency | Engineer-days |
|---|---|---|---|
| 1 | Action schemas, minimal context, owner/salon guards, policy allowlist and adversarial fixtures | Confirm scope | 2–3 |
| 2 | Prepared-operation store, transactional receipts, expiry/conflict/undo primitives; guarded new migration if needed | 1; retention decision | 3–5 |
| 3 | Menu reorder adapter and deterministic review/receipt card | 2; shared reorder validation | 1–2 |
| 4 | Price-only shared command, max-five atomic update, explicit currency | 2; service compatibility/snapshot tests | 3–4 |
| 5 | Text-only draft adapter with lifecycle-aware undo | 2; existing draft lifecycle | 1–2 |
| 6 | Minimal client interval adapter preserving version guard | 2; shared client mutation | 1–2 |
| 7 | Owner chat shell, shortcut cards, model-to-proposal routing and deterministic setup/navigation | 3–6; provider access | 3–4 |
| 8 | Structured feedback submission and restricted triage list | 1–2; reviewer/retention decisions | 2–3 |
| 9 | Model evaluations, mobile accessibility, cost limits, restart/duplicate tests, pilot flag | 7–8 | 3–4 |

Assistant subtotal: 19–29 engineer-days. Direct UI fixes: 5–9 additional days. Combined: roughly 5–8 working weeks for one engineer familiar with the repository, with a separate two-week small-owner pilot. Scope discovery, availability of reviewers, and migrations can extend this. No active Stripe files, ledger, webhook, pricing-plan, messaging or payment implementation belongs in these changes.

Pilot release includes all four tested actions; if time is constrained, omit menu ordering and ship the other three rather than removing conflict/duplicate protection. UI phases can proceed independently. Future implementation starts from latest main in its own clean worktree; this artifact changes no branch.

## Acceptance tests and release gate

Application tests (isolated DB/provider mocks):

- Wrong salon/foreign service/client IDs are rejected on prepare, apply, receipt read and undo; owner permission is rechecked after preview and at execution; staff/impersonation sessions cannot write.
- Identical names force selection; model text, stored bios and feedback cannot introduce extra tools or authorize confirmation. Excluded actions remain absent server-side.
- Tampered, stale, expired, cross-actor or changed-salon proposals cannot apply. Concurrent normal-editor writes participate in the same safety contract.
- Double click, retry after a committed-but-lost response, process interruption and repeated undo produce at most one mutation per operation and a truthful receipt. Mutation and receipt rollback together.
- Price updates preserve all unrelated fields and booking snapshots; five-service failure rolls back the whole batch; unsupported variants/special pricing are rejected.
- Reorder preserves membership/category/featured state; additions during preview invalidate it.
- Draft-copy save leaves live content and unrelated draft edits untouched; publishing invalidates inverse draft changes.
- Client interval computes normal due state, preserves other fields and sends no messages; an intervening visit invalidates undo.
- Feedback does not capture hidden PII; retries do not duplicate; permissions protect triage and withdrawal.

Browser tests: keyboard/screen-reader review cards, mobile keyboard and safe-area geometry, clear busy/error/unknown states, switching salon mid-proposal, browser back, non-chat editor fallback, and receipts linking to the correct record. Use existing mobile projects and appointment regression where touched. Run normal type/lint/relevant full-suite gates during implementation, not now.

Model evaluation: at least 80 curated utterances across four actions, ambiguous IDs/amounts, misspellings, unsupported requests and prompt injection. Pilot target: >=95% correct action/clarification classification, 100% correct displayed price parsing in the fixture set, zero unauthorized writes in deterministic/adversarial tests. These are acceptance goals, not current measured results or guarantees. Typed forms remain usable when the model is unavailable.

Pilot success: 5–10 owners, two weeks; measure completed actions, corrections before confirmation, undo/conflict frequency, task time versus manual UI, unresolved failures, feedback themes and actual token costs. Continue only if actions save time and do not increase owner mistakes. Don't optimize chat volume.

## Low-cost AI approach and assumptions

One small model generates a validated action proposal or draft text. Application code handles fetching, calculations, permissions, previews, confirmation, execution, receipts and undo. Use structured outputs; no open-ended tool loop, autonomous retries or model-generated SQL. Limit to two model calls per request, short context, and selected relevant records. Buttons, setup checks, navigation links, feedback submission and successful-action receipts can run without any model call. No vector database, web search, voice, image analysis, fine-tuning or flagship fallback in V1.

For budgeting, use GPT-5.4 mini as an evaluation candidate, not a preselected winner: published standard rates are US$0.75 per million input tokens and US$4.50 per million output tokens. Source checked September 14, 2026: https://developers.openai.com/api/docs/models/gpt-5.4-mini . Use a server-side provider adapter; existing deployment infrastructure may route via AI Gateway, with any routing fees verified separately at implementation. Model/API credentials stay server-side; no provider setup occurs now.

Explicit workload assumption: each AI-assisted request totals 6,000 input tokens and 1,200 billable output tokens across all calls, including any reasoning tokens. No cache discount assumed. Cost = 6,000/1M × $0.75 + 1,200/1M × $4.50 = $0.0099, approximately one US cent per request.

| Monthly usage assumption | Model-only estimate | 2× planning allowance |
|---|---:|---:|
| 10 pilot owners × 40 AI requests | $3.96 | $7.92 |
| 100 owners × 40 AI requests | $39.60 | $79.20 |
| 1,000 owners × 40 AI requests | $396 | $792 |

The allowance is sensitivity, not a guarantee; long reasoning/context and repeated failures may exceed it. Hosting, DB/storage, monitoring, optional gateway fees, regional premiums, tax and human support are excluded. Text-only navigation/buttons may reduce real model use; do not assume those savings before measurement. Engineering and support likely dominate the pilot cost.

Proposed pilot controls: 40 AI-assisted requests per owner/month, 10/day, server-side token reservation and a US$25 total pilot model budget for ten owners. At the cap, keep normal controls, feedback and prepared deterministic confirmations working; offer the matching editor instead of upselling via active Stripe billing. Budget/rate-limit reservations must handle parallel requests. Log measured token usage without client text. Choose/lock a model version after quality, latency and safety evaluations; reprice if the selected model differs.

## Deferred scope

Customer helper; payment/refund/card actions; bulk or individual message sending; cancellations/deletions; service creation/activation; publishing or whole-draft revert; appointment creation/moves; business-hours/time-off changes; advanced catalog rules/variants; automated price recommendations; uploads/voice; marketing automation; autonomous browser/database tools; background agents; broad search over client records; country expansion; AI-specific subscriptions/credits. Each is outside V1, not silently routed to another tool.

## Genuine owner decisions before implementation/rollout

1. Pilot group and access: recommend 5–10 real owners and owner-only access. Need named candidates before recruiting; no outreach is authorized by this plan.
2. Live-price behavior: confirm that a reviewed explicit price change should apply immediately to new selections. Existing menu prices are not page-content drafts. If you require scheduled/draft prices, defer price action or separately scope that feature.
3. Data retention/access: proposed 30-day chat retention, 90-day feedback retention, and 90-day minimal action receipts (10-minute proposal expiry). Choose who may access feedback and how export/deletion and withdrawal work. Retain normal application audit history under its existing policy; these proposed periods are not legal advice or current behavior.
4. Pilot spend: recommend no extra charge during pilot, with the usage limits/budget above; later packaging is a separate product decision and must not touch the active Stripe work.

No additional permission or implementation request is being asked for now. These are decisions to resolve when proceeding, not reasons to leave this planning task incomplete.
