# Offline provider journal fixtures

This directory is an inert rehearsal of a future provider boundary. It is not a
Stripe integration. Nothing here is mounted as a route, webhook consumer or
scheduled worker, and no operation result can credit or refund appointment money.

`CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED=true` and the preparation switch are
required with `NODE_ENV=test`. Production application/deployment markers also
refuse the gate. Development and production application builds cannot run this
fixture seam even when the switch is set. No credentials are read.

## Evidence and provenance

The receipt verifier authenticates the original bytes through an explicitly
injected offline signature check. It parses those same bytes, keeps only bounded
identity and monetary facts, and records a digest instead of raw customer data.
An invalid signature yields no receipt. Authenticated malformed, unmatched,
unsupported or scope-mismatched evidence remains a review receipt.

Receipt provenance is `offline_signed_fixture`. Runtime branding prevents casts
and JSON deserialization from creating authenticated receipt inputs. This proves
only the injected fixture check, not that Stripe moved money. The provenance is
distinct from the existing `synthetic_test` financial ledger and is never
converted into that ledger's inputs.

Inbox event identity and each consumer/version's delivery are separate. A deposit
consumer's terminal result therefore cannot suppress another consumer. Conflicting
evidence remains retained and blocks trusted completion. Consumer completion is
processing history, never payment success.

## Outbox and uncertain results

Operations persist the tenant, appointment, immutable quote context, account scope,
API version, exact parameter hash and one stable idempotency key. Customer refunds
and application-fee returns are distinct operations. A successful checkout-create
fixture identifies a session, not a successful charge.

The only transport is a privately branded, closed fixture response map. It accepts
no injected network callback. Dispatching is saved before invoking that transport,
outside database transactions. Leases and versions fence stale workers and their
results. A missing response or interrupted result write cannot justify a new
operation or a blind resend.

Reconciliation requires a fresh claim and an observation bound to the original
operation. An explicitly absent fixture result can requeue only inside the
original conservative idempotency window. Expiry or unresolved evidence requires
review. The window never resets on a retry.

## Deliberately missing authority

There is no real Stripe client, live/test API call, endpoint registration,
financial posting, customer refund, fee return, credential configuration or
deployment. No synthetic result is a legal tax credit note or real payment proof.
Future integration must verify real provider/account relationships, authorization,
current quote and refund limits, canonical settlement, tax/fee policies and
rollout controls before these patterns can be used with external services.

See `docs/customer-payments-provider-adapter-plan.md` for the existing webhook
hazard, verified Stripe documentation and prerequisites for external testing.
