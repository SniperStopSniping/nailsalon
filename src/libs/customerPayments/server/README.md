# Durable local rehearsal only

`openCustomerPaymentRehearsalStore` persists synthetic attempts and receipts in a
caller-created `luster-payment-rehearsal-*` directory immediately beneath the OS
temporary directory. It accepts no connection URL and never imports the shared
application DB, Stripe, credentials, or appointment/deposit writers. Explicit
nonproduction test configuration is required; production process/deployment is
refused independently. There is no API route or production adapter registration.

The fixture exercises disk reopen, tenant-scoped reads, one attempt per appointment,
immutable quote/account snapshots, pending versus paid state, account-scoped unique
session/event/refund identities, payment-intent uniqueness, transactional receipt
and revision updates, rollback, late-payment recovery, and partial/full refunds.
Evidence here is **synthetic**, not authenticated Stripe evidence. Original application
fees bind independently to the captured intent/account/currency/amount. Successful
fee refunds have their own unique durable receipts and cumulative proportional
ceiling; storing a customer refund never claims the fee was refunded. Premature
fee evidence rolls back and must be retained/retried by a future verified receipt
driver after customer refund evidence arrives. A real external fee refund above
the policy target is still money returned: retain its verified evidence and hold
it for reconciliation rather than discard it. PGlite serializes its single
connection, so these checks do not certify multi-connection PostgreSQL locking.

## Required before connecting booking/accounting

- Authorize each customer action with existing appointment access capabilities;
  bind salon/appointment from server state, never submitted IDs alone. Existing
  access is in `appointmentAccess.ts` and capability issuance in booking effects.
- Obtain server-owned Connect binding and independently verify actual provider
  client mode and account mode. No provider interface/real adapter is installed in
  this slice, so no flag can initiate a provider request.
- Validate frozen invoice currency and tax snapshot chain, authoritative service
  prices, discounts, fee policy and tip. A quote must not be browser authoritative.
- Lock and reconcile canonical `appointmentPaymentLedger.ts` tender and
  `appointmentDepositFinancials.ts` credit before deciding any collectible balance.
  Refuse legacy paid ambiguity and stale quote/account versions. Never turn new
  full prepayments into legacy deposits or count the same money in both ledgers.
- Design one atomic settlement that records new tender exactly once and carries
  the prepaid tip to the final invoice. Cancellation/late success must not revive
  released appointments. Historical successful money must remain accounted for
  even during review, refunds, retries and out-of-order events.
- Retain verified webhook receipts before processing, using existing Connect
  receipt safeguards; verify signature, event account, livemode, session, intent,
  amount, currency, fee and metadata. Redirects cannot prove payment. Persist a
  recoverable provider-operation/outbox boundary before calling a provider.
- Connect verified refund operation states and the independent fee-refund receipt
  foundation to provider reconciliation, audit and authorization. The local store
  does not establish authenticity or perform any refund.
- Design/review application schema migration and verify actual PostgreSQL
  multi-connection races against the repository's attested disposable target.
  No migration has been added or applied by this rehearsal.

No existing booking, deposit, billing, receipt, or reporting behavior is changed.
This is an integration foundation, not enabled customer payments.
