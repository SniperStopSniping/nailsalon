# Customer receptionist conversation correction

## Observed failure and cause

On the deployed #275 application, three consecutive UI turns — “How much is gel manicure”, “What was my question”, and “I said what’s the price” — all rendered the same service description and broad menu chips. This safely reproduces the reported customer-visible defect; it does not establish the contents of the unavailable original Production model response.

The interpretation call was a strict no-prose classifier. Its public menu omitted prices/durations; it received prior user messages but not actual assistant replies. The resolver substituted canned educational copy. A price question and conversational repair therefore had no useful representation. The frontend already rendered the response message; it was not dropping a valid natural answer.

## Boundary correction

The existing interpreter still extracts semantic facts and action intent. Informational subjects are separate from requested booking selections. Bounded, salon-bound signed state now includes actual role-labelled dialogue. Luster resolves the existing menu/selection through the same catalogue/L1 and availability paths.

A second bounded, read-only composition call receives fresh public business/menu facts, actual dialogue, semantic state and the authoritative result. Its response contains conversational text and fact references. Luster substitutes complete server-authored statements for prices, durations, configured subtotals, comparisons, contact details, policies and checked availability. A current-selection price/duration answer must include the configured selection fact. Required clarification/limitation facts cannot be omitted. Unknown references/options reject; a safe deterministic fallback preserves the authoritative result.

The natural-language guard is heuristic, not a proof against all possible hallucinations. Human review of real-model transcripts and live rendered conversations is a release requirement. The model has no tools or write permissions and cannot create appointments, reserve time, send messages or alter financial state. Normal booking remains Choose these services → Time → Details/reminders → Confirm.

## Operational limits and privacy

Both calls use the existing Customer AI model, gpt-5.6-luna, low reasoning. Interpretation output is capped at 1,200 tokens; composition at 800. Composition fits the remaining bounded turn time. Its input plus schema is capped at 24 KB. Existing per-session/IP/salon reservations, replay and usage ledger apply to the whole turn. Usage from both calls is summed; an unknown call makes aggregate usage unknown, never zero. No private real-customer transcript logging is introduced. Synthetic evaluation uses `store: false` and explicitly bounded cost.

History is bounded without discarding semantic choices or changing session/lifetime limits. Public business facts reuse live published booking-page display/privacy rules. Hidden addresses, raw salon settings, private customer data and unpublished content are not model context. Legacy add-ons must be reachable from an active public service.

## Compatibility

No schema migration, provider configuration, model switch, pilot expansion or billing activation is included. Appointment completion #275, durable booking recovery #274, Owner Assistant, reminders, review automation, payments, tenant configuration and calendar blocks are outside the write scope.

The assistant retains the existing normal booking handoff. Small UI corrections restore keyboard focus after a response and prevent proposal subtotal clipping at 320px with 200% text. They do not create another booking form.

## Verification artifacts

The synthetic runner is `scripts/customer-conversation-eval.mts`; cases are in `src/libs/customerAssistant/__evals__/conversationCases.ts`. It records interpreted state, rendered reply, provider usage, latency, fallback classification and checks against resolved values. Automated flags require human classification; exact topic labels or sentence wording are not the customer acceptance criterion.

Detailed local evidence and checkpoints are preserved outside the code checkout in `customer-ai-conversation-evidence-20260920`. Release and live acceptance results are recorded there only after execution; this document does not imply deployment.
