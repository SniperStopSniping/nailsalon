# Closed-test durable checkout fence

## Boundary

`inactiveStripe/durableCheckoutRepository.ts` and `durableCheckoutDispatcher.ts`
exercise durable ownership for the existing immutable checkout operation contract.
They are unregistered, require the test runtime and accept only a private-branded,
in-memory scripted transport. They do not invoke or register the Stripe SDK
adapter. There is no provider credential, network fallback, application route,
webhook consumer or money writer in this slice.

Migration 0126 adds separate closed-test operation, state, object ownership,
conflict, observation and audit tables. It does not alter existing deposit or
payment tables. Every operation remains `closed_test_fixture`, with
`providerOriginVerified: false` and `financialPostingAllowed: false`. These rows
must never be promoted into real-provider evidence.

## Saved quote binding

Reservation uses the saved, full-only test quote's exact tenant, appointment,
connected account, fingerprint, complete monetary snapshot and creation/expiry
times. The helper rereads current policy, capability, account binding, salon,
appointment, services, add-ons and all payment/deposit history, then reuses
`buildCustomerPaymentQuoteMaterial` to compare the complete source fingerprint.
Deposit holds or history, existing money, revoked access and stale source material fail
closed. Capability IDs are not proof that a caller possesses the private link.

Database time is sampled again after awaited reads and locks. The final fake
consumption also checks runtime, lease and quote expiry without an intervening
await. This detects stale fixture material; it does not authenticate a customer,
reserve a booking slot or fence every source writer after commit. Saved quotes
remain explicitly non-executable. No actual SDK bridge is permitted by this
check alone.

## Durable invariants

- Immutable identities reserve operation, request and appointment ownership.
  Exact replay returns the existing operation; conflicting identities retain
  evidence and hold affected operations for review.
- Versioned leases can recover work before dispatch intent. Dispatch intent is
  committed before a one-use consumption marker is committed, and both precede
  fake consumption. An uncertain commit cannot authorize a send. A restart,
  timeout, expired lease, missing result or 404 cannot reset the create latch.
- Reconciliation is an exact bound Session read only. There is no metadata/search
  fallback, absence-based create retry or automatic release of reservations.
- State transitions have append-only audits. Observations keep allowlisted
  identifiers/status fields, not raw response bodies, return URLs, customer
  details or credentials. Conflicts and ownership history remain immutable.
- Late evidence must retain its safe observation and object ownership without
  receiving a current worker's state authority. Review remains sticky; exact
  known observation replay does not clear it or create a fresh hold.
- The closed transport is a static script with an internal test barrier, not an
  injected callback or SDK HTTP client. Its observations cannot authorize
  canonical payment or refund posting.

## Verification and remaining work

Final verification for this checkpoint is recorded in
`customer-payments-integration-gates.md`.

This is local persistence and concurrency coverage, not a successful Stripe
sandbox payment. Real execution still needs a separately reviewed durable SDK
bridge and provider provenance boundary, authenticated checkout authorization,
booking reservation/late-payment handling, verified ingress and settlement,
refund/review workflows, isolated application/account configuration and permitted
provider tests. Commercial policy, application migration, deployment and
activation remain separate gates. Existing production payment switches stay off.
