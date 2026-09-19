# Customer booking facts and clarification authority

Customer AI remains gated by its existing server configuration and Isla-only
allowlist. This change does not activate a salon, alter the L1 engine, or change
appointment creation, deposits, reminders, Owner Assistant or billing.

GPT extracts bounded semantic facts and suggests service/option identities. The
signed customer conversation preserves those facts independently of the model's
candidate IDs. Route-resolved public salon identity disambiguates references such
as “from here”; customer or model text cannot change tenant context. A fact change
invalidates the accepted proposal and offered booking state.

For L1, every service proposal or clarification enters `planCustomerClarification`.
The planner considers fact-compatible public service candidates and calls the
same `resolveCatalogSelection` used by manual booking. It may prove a completion
by adding only missing required group/dependency choices or requested semantic
choices. Every step re-runs the resolver. A shared, memoized budget of at most 512
resolutions bounds the search; exhaustion fails closed.

A completion witness is not a customer selection. Unanswered required choices
remain questions. Options are offered only when they have a compatible completion
under the preserved facts, including existing selected art, quantities and L1
exclusions. A uniquely resolved explicit customer fact may be selected; arbitrary
witness choices cannot. Automatic or already-selected no-op options are reviewed
in the proposal rather than presented as optional questions. If a model asks an
irrelevant dimension, a complete authoritative selection proceeds to proposal.
Genuine ambiguity between viable services produces a service question.

The full public snapshot stays inside the server-side planner. GPT receives the
existing bounded menu DTO, not snapshot revision material or private capability
metadata. Clarification viability is catalog viability, not a promise of staff
availability. Existing authoritative quote, eligibility, availability, review and
transaction-time checks remain mandatory. GPT and the planner compute no prices
or durations.

Other-salon removal is not inferred from a generic label. If current catalog
metadata cannot distinguish product/origin semantics, the assistant fails closed
rather than substituting own-salon removal or inventing a replacement/surcharge
relationship. That remains an owner catalog decision.

## Verification

- `clarification.test.ts`: unrelated service dimensions; required groups;
  automatic choices; forbidden and dependent options; quantity limits; preserved
  French/art combinations; removal origin; ambiguity; wrong-tenant identifiers;
  and bounded-search failure.
- `turn.server.test.ts`: the failed BIAB interpretation becomes an authoritative
  proposal; snapshots are not sent to GPT; fact corrections invalidate old state.
- `customer-semantic-eval.mts`: opt-in, private credential file, Luna low,
  `store:false`, synthetic L1 only, bounded cost and fail-stop evidence. Scoring
  uses the production planner and canonical resolver, not prompt-computed totals.
- Existing appointment regressions and disposable PostgreSQL Chromium/WebKit
  journeys remain required before release. Provider evaluation is not a payment,
  messaging, booking, or activation test.
