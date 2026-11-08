# Verified provider adapter: next implementation boundary

This is an implementation assessment, not an installed provider adapter or
authorization to run payments. No Stripe account/API operation, credential change,
webhook registration, application migration or deployment was performed.

## Existing code and integration hazard

- `src/libs/customerPayments/checkout.ts` builds direct-charge parameters; it
  does not create a provider session. `attempt.ts` and `refunds.ts` supply local
  lifecycle/math contracts, not verified provider authority.
- `src/app/api/webhooks/stripe-connect/route.ts` verifies raw-body signatures,
  claims an event globally, dispatches deposit/account handling and records one
  terminal outcome. A customer-payment consumer added after that dispatch could
  be skipped after a deposit handler classified the event as terminal.
- That route also performs late-deposit recovery and refund discovery/adoption.
  Those paths can invoke Stripe. Do not import or reuse its dispatch wholesale
  for a no-network customer-payment adapter.
- `src/libs/stripe.ts` pins API version `2024-06-20` and initializes a shared
  credential-backed client. Do not silently change its version, timeout, retries
  or billing behavior while implementing customer payments.

## Proposed inert local slice

1. **Verified receipt boundary.** Inject an offline signature verifier and a
   fixed endpoint configuration. Persist authenticated evidence before processing:
   endpoint/platform scope, account scope, actual mode, event/object identifiers,
   API version, payload digest, normalized relevant facts and receipt time.
   Invalid signatures create no financial rows. Authenticated but unmatched money
   remains retained for review; it is not silently acknowledged as no movement.
2. **Independent consumer delivery.** Give each inbox event a separate delivery
   record per consumer/version, with fenced claims and retry state. Deposit,
   customer-payment and fee consumers must not suppress one another. Deduplicate
   both transport events and immutable business movements, including event fanout.
3. **Recoverable operation journal.** Persist operation identity, tenant, immutable
   quote/context, account/mode, exact parameter hash, API version and stable
   idempotency key before dispatch. Checkout creation, customer refunds and fee
   returns are different operations. Inject transport; perform no network work
   while financial database locks are held.
4. **Uncertain outcomes.** A timeout or crash after dispatch is uncertain, not a
   failed payment. Keep the same operation identity and reconcile it before any
   retry. Fence stale workers. Expired provider idempotency retention requires
   reconciliation rather than blindly reusing a key or generating a new one.
5. **Verified relationships.** Validate session/intent/charge, refund/charge,
   application-fee/charge and fee-return/fee relationships. Match currency,
   amount, actual mode, account and original operation. Metadata and cached
   Connect flags alone are insufficient. Distinguish platform fee events from
   connected-account customer events; do not manufacture a missing account field.
6. **Separate provenance.** Do not rename synthetic evidence as verified money.
   Introduce a distinct verified-provider source and adapter. Extend immutable
   settlement/refund/credit protections only after receipt and relationship
   validation. Old redirects, buttons and scalar payment status cannot assert
   payment success.

Implement this with dependency injection, migrations in source, offline signature
fixtures, fake transport and disposable-database tests only. Do not register a
route/worker or import the global Stripe client in the first slice. Test duplicate
and conflicting receipts, per-consumer fanout, scope/mode mismatch, late and
out-of-order outcomes, unknown money, lease races, crash recovery, idempotency
retention boundaries and independent customer/fee returns.

## Provider facts supporting the design

- [Stripe webhook guidance](https://docs.stripe.com/webhooks) requires the original
  request body for signature verification. Deliveries may repeat or arrive out of
  order; separate event objects can also describe the same business object.
- [Connect webhook scopes](https://docs.stripe.com/connect/webhooks) distinguish
  platform and connected-account events. Connected events identify their account;
  production endpoints can receive both test and live events, so verify mode.
- [API v1 idempotency](https://docs.stripe.com/api/idempotent_requests) replays the
  first executed response, including errors, and keys may be pruned after at least
  24 hours. [Advanced error handling](https://docs.stripe.com/error-low-level)
  explains uncertain network/server outcomes. Do not confuse these v1 semantics
  with the different v2 contract.
- [Direct charges](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted)
  place charge/intent objects on the connected account while application fees
  increase the platform balance. The [fee-refund object](https://docs.stripe.com/api/fee_refunds/object)
  has its own identity and references the application fee it returns.

## Still required before external testing

Approve the actual sandbox/platform and connected account, allowed test operations
and limits, fixture/customer data and endpoint destinations. Confirm the fee payer,
tax/refund policy, account responsibilities and actual Stripe/Connect costs.
Use authorized credentials securely; new credentials or persistent access require
separate approval. Endpoint registration/configuration, application migrations,
deployment, live payments and real refunds remain outside this local work.

The current credit-review workflow resolves only clean completed synthetic
invoices for credit-aware read paths. Ordinary collection/lifecycle actions,
unfinalized or held money, generic receipt/spend readers and real provider handling
still require explicit integration. Synthetic credit allocations are not legal
tax credit notes.
