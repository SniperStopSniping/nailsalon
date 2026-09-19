# Isla customer receptionist refinement

The customer assistant remains gated to `isla-nail-studio`. Owner Assistant authority, billing switches, catalog data and provider credentials are unchanged.

## Conversation authority

GPT-5.6 Luna, low reasoning, `store:false`, interprets customer language into bounded fact updates and public catalog references. Current nail product/origin are separate from desired treatment/application/length/design/repairs. Unanswered product information is distinct from an explicitly uncertain customer.

A signed `requestedSelection` is a non-authoritative desired draft. It survives informational answers and incomplete clarification. Explicit changes invalidate the previously presented proposal and accepted booking context. The last answer topic/options are retained separately so relative replies refer to the choices actually shown. Asking about BIAB does not itself replace a desired Gel-X booking.

`resolveCustomerTurn` is shared runtime orchestration. The real-model evaluation invokes that same function with synthetic L1 authority adapters. Neither GPT nor this adapter calculates price/duration. Catalog resolution, clarification viability, proposal construction and availability retain their existing Luster authorities. Public service descriptions/limited educational copy answer informational questions; arbitrary model prose cannot become booking terms.

Before an actionable selection, unanswered current-product information is requested when the resolved L1 service has a viable removal path. Known facts and explicit refusal of removal are preserved. Unsupported acrylic removal and unresolved other-salon product semantics fail specifically and safely; no catalog data is changed.

## One booking UI

`Choose these services` revalidates the proposal fingerprint, issues a tenant-bound flow identity, and hydrates existing normal booking selection state. The assistant closes and navigates to normal Time. Normal contact, required phone, #245 reminder control, policy acknowledgment, payment disclosure and Confirm remain the UI authority. Chat has no separate time picker, contact/reminder form or confirmation button.

The nonsecret `bookingFlow=assistant` marker survives normal navigation and manual selection edits. The opaque signed flow token stays in session storage. Missing, corrupt or expired handoff state cannot silently fall back to a fresh legacy appointment request.

The normal Confirm button uses the existing durable customer booking authority for accepted assistant flows. Preparation compares all rendered terms against fresh authoritative state: service/add-ons, names, price/duration/currency, technician/location, local time/timezone, confirmation/reminder modes, deposit fingerprint and policy version. Changed terms require another review. Explicit technician and location are carried through the same creation transaction. Campaign/reschedule contexts are rejected visibly by this adapter rather than silently dropping their authority.

A flow has one durable operation. The operation capability is persisted before creation. Refresh/retry first reads original status; an ambiguous create never mints a second operation. Lost preparation responses recover the same operation, including after edits or review expiry. Renewing an expired signed handoff requires a current revalidated proposal and retains the same identity. Deposits retain existing pending/hold/secure-payment/resume semantics; payment-required is never presented as confirmed.

## Availability and session life

Conversational availability is advisory. It uses the public availability engine and fresh authoritative selection, strips private metadata, and holds nothing. Unqualified requests search actual dates from salon-local today, skipping empty days, bounded to seven days and a request deadline. Explicit empty-day requests explain the absence and offer the next actual available date. Final Time and creation revalidate independently.

The prior code had a fixed 30-minute conversation and a combined 12-action ceiling. An exact Production request explaining the reported expiration was not retained, so its specific cause is unproven. The revised session has a 30-minute sliding idle limit, two-hour absolute limit, 32-turn limit, bounded signed history and unchanged shared IP/salon/spend controls. Exact completed request retries can retrieve their signed response from a bounded Redis cache. Expiry, stale/replayed state and session limits have separate customer recovery messages. Recovery never resurrects an unsafe booking operation.

## Validation and pilot limits

Use synthetic catalogs/customers and the attested local disposable PostgreSQL target. No Production booking/message/payment is needed to validate this refinement. Focused tests cover semantic updates, current/desired separation, L1 clarification applicability, late-night availability, durable retries, concurrent claims, stale terms, reminder integration and mobile handoff. The opt-in `scripts/customer-receptionist-eval.mts` uses a named private credential file and writes a local 0600 report; it never accesses a database or sends customer messages.

The assistant does not provide medical advice, promise unsupported removals, guess ambiguous other-salon product relationships, or replace the salon's judgment. Informational coverage is bounded to supported nail-service topics and published menu descriptions. The pilot remains Isla-only.

### Reviewed evidence (2026-09-19)

- Real GPT-5.6 Luna, low, `store:false`: 27/27 turns passed in the final 8-scenario runtime evaluation, $0.014091 for that run. Full synthetic trace: `artifacts/customer-assistant/receptionist-evaluation-2026-09-19.json`. Independent review inspected complete meanings and selections, including corrections, acrylic/current-product state, outcome requests, informational questions and timing feedback. Earlier runs exposed genuine issues that were corrected; this is not a claim of universal nail-language coverage.
- Real disposable PostgreSQL: 12 operation-store cases and 30 appointment-creator cases, zero skips. These cover recovery identity, concurrent slot claims, stale selection/technician checks and existing deposit behavior.
- Four actual-handler browser journeys: Chromium/WebKit × legacy/L1, each using real normal server-page props, normal Time/Confirm components and real PostgreSQL. Each intentionally loses the successful creation response, recovers status, refreshes, and verifies exactly one appointment and one durable operation. External messaging, model transport and quota infrastructure are substituted; no real message or payment occurs.
- Focused customer domain/routes/state: 251 tests passed (separate database lanes excluded from this unit run). Normal prepare/Confirm/semantic focused set: 124 passed. Appointment regression: 103 passed. Deposit regressions: 290 passed (separate PostgreSQL lanes excluded).
- Type checking and changed-source lint pass; lint retains existing warnings. All 12 Chromium/WebKit component journeys pass, including 320px/200% text, native Back/Forward, reopening, optional quick replies and fixed-control clearance. The launcher uses the existing fixed Service-bar clearance and an end spacer; it is hidden while an editable control has the mobile keyboard open. Hosted release evidence is recorded with the PR/release.

The handoff tests also caught a boundary-format discrepancy: the shared availability engine emits single-digit hours (for example `9:00`), while the customer adapter uses canonical `09:00`. Canonicalization now preserves those authoritative morning slots and accepts identical reviewed times; all timezone/start-time and stale-review checks remain in place.
