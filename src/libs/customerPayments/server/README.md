# Customer payment preparation and isolated rehearsal

Customer collection remains disabled. This directory has two separate persistence
paths. Neither creates a provider session, charges money, refunds money, or writes
appointment tender/deposit/invoice state.

## Application-table preparation

`preparationRepository.ts` uses an injected shared application database handle,
not the temporary rehearsal store. Additive migration
`0115_customer_payment_preparation.sql` defines three tables:

- Per-salon draft policy, with collection permanently false and mode constrained
  to test. Owner edits use a revision check and salon `FOR NO KEY UPDATE` lock.
- Immutable policy request receipts for exact actor/tenant/request replay.
- Immutable, explicitly non-executable prepared quotes, with tenant appointment
  foreign keys, unique request identity and a maximum of 50 drafts per appointment.

The migration exists in source and is exercised through the actual journal in
isolated in-memory PGlite fixtures. It has not been applied to an application DB.
The separate schema module is included in `drizzle.config.ts`; existing salon and
appointment row shapes are unchanged.

`prepareQuoteForToken.ts` identifies the appointment through a hashed capability,
then revalidates that capability under the appointment lock on every request,
including replay. It reads current draft policy, a locked cached test-mode Connect
binding, frozen tax and booking item snapshots. A stable fingerprint binds the
policy revision, account, financial/context evidence and original expiry.
Revoked/expired capability, stale evidence, manual prices, unsupported currency,
finalized invoices, or any existing tender/deposit history are refused. Historical
wrong-tenant tender attached to the appointment is not silently filtered away.

Two gated API surfaces exist:

- Owner-only `GET/PATCH /api/admin/salon/customer-payments` manages draft policy.
- Capability-bound `POST /api/public/appointments/manage/[token]/payment-quote`
  persists a quote and returns only public totals and non-executable identifiers.

`CUSTOMER_PAYMENTS_PREPARATION_ENABLED=true` is required in an approved nonproduction
runtime. Production application/deployment markers are independently denied.
The display rehearsal flag does not enable preparation. The customer quote route checks origin and body before database imports; the
owner route checks origin before owner authorization and parses edits before
loading the preparation repository. No provider URLs, account IDs, raw capabilities or
server-only context are returned. Cached account flags are evidence pinned for
staleness, never authorization to make a future provider call.

## Durable local rehearsal only

`openCustomerPaymentRehearsalStore` remains a separate synthetic lifecycle test
store in a caller-created `luster-payment-rehearsal-*` OS temporary directory. It
accepts no connection URL and never imports the shared application DB, Stripe,
credentials, or appointment/deposit writers. It is not wired to either API.
Explicit nonproduction test configuration is required; production process and
deployment markers are independently refused.

Fixtures cover disk reopen, tenant-scoped reads, one attempt per appointment,
immutable quote/account snapshots, pending versus paid state, unique provider-like
session/event/refund identities, payment-intent uniqueness, transactional receipts
and revision checks, rollback, late-payment recovery, and partial/full refunds.
All provider evidence here is synthetic. Original application fees bind separately
to the captured intent/account/currency/amount. Successful fee refunds have their
own receipts; recording a customer refund never claims the fee was refunded.

A proportional refund cap constrains requested/projected refunds, not external
facts. A verified external fee refund exceeding that cap must first be retained
in an immutable verified event store, then held for reconciliation. Never discard
or acknowledge it as no movement because the rehearsal projection rejects it.
Premature fee evidence likewise needs retained receipt/retry handling in a future
verified driver. No such production receipt driver is installed by this slice.

## Required before collection or accounting integration

- Implement a provider adapter that independently verifies actual client and
  account test mode, rechecks authorization and every financial source, and
  persists a recoverable operation/outbox boundary before provider calls.
- Reconcile canonical `appointmentPaymentLedger.ts` tender and
  `appointmentDepositFinancials.ts` credit before any collectible balance decision.
  Preserve required deposits and legacy-paid ambiguity. Never represent a full
  prepayment as a legacy deposit or count the same capture twice.
- Design atomic settlement and ownership/provenance guards, including blocking
  manual void of provider-owned tender. Preserve prepaid tips at checkout and
  final invoice; late success must not revive released appointments.
- Model verified refund allocations and invoice credits or collection holds so
  refunds do not silently reopen receivables. Preserve gross capture history and
  historical reporting rather than relying on current void-and-replacement rows.
- Retain signature-verified webhook receipts before processing. Match event
  account, mode, session, intent, amount, currency, fee and metadata. Redirects
  are not evidence. Customer refunds and application-fee refunds remain separate.
- Verify future money-processing races against the repository's attested
  disposable PostgreSQL target. Preparation-only race verification is recorded
  below; it does not certify future settlement/refund writers. PGlite serializes
  one connection and cannot prove those locks. New money-processing schemas and
  migrations remain future work; migration 0115 stores preparation only.

Existing booking, deposit, billing, receipt and reporting financial behavior is
unchanged. These are test-only preparation foundations, not enabled payments.

## Opt-in PostgreSQL preparation concurrency gate

`preparation.concurrency.integration.test.ts` is separate from PGlite coverage.
It requires an already provisioned, disposable PostgreSQL target accepted by
`disposableDatabaseTarget.ts`, including `LUSTER_DISPOSABLE_DATABASE=true`.
Container-backed targets require matching container ID/network evidence. The guard
also supports a dedicated native loopback cluster on port 55432 without container
evidence; prescribed role, database, application name and live session attestation
remain mandatory in either case. It accepts only the dedicated
`CUSTOMER_PAYMENT_PREPARATION_TEST_DATABASE_URL`, never an ambient `DATABASE_URL`.
Do not point it at an application, shared development, preview or production DB.

After separately authorizing/provisioning the attested disposable target, run:

```sh
CUSTOMER_PAYMENT_PREPARATION_PG_REQUIRED=true \
  /usr/local/bin/node node_modules/vitest/vitest.mjs run \
  src/libs/customerPayments/server/preparation.concurrency.integration.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

Supply the dedicated URL and disposable attestation environment through the test
runner's secure environment, not command output or documentation. The suite
attests each of four physical sessions before applying the real migration journal
and creating synthetic fixtures. It cleans up only its own tenant rows. It never
calls providers. Use this required-mode gate in an isolated CI job, not alongside
another suite that resets the same disposable database.

Coverage includes observed PostgreSQL blocking chains, competing policy CAS,
identical-request replay, same-key quote serialization/revalidation, the 49-to-50
draft cap race, and a policy-writer versus quote lock-order scenario with explicit
salon `KEY SHARE`. No target means five explicit skips. Required mode with no target
fails before any connection; an invalid supplied target always fails validation.

Latest verification: all five tests passed against PostgreSQL 16.15 using four
separately attested physical sessions and the real migration journal. The run used
a newly created private native cluster on `127.0.0.1:55432`, an ephemeral generated
SCRAM password, and the prescribed disposable role/database/application name.
No software was installed and no existing service or application DB was touched.
The temporary cluster was stopped and removed afterward; the port was confirmed
free. No provider calls or application activation occurred.

Absent-target guards were also verified: ordinary mode skips all five tests;
required mode fails before connection. This verifies the preparation repository's
current locking/CAS/replay/cap scenarios, not live payments or future financial
writers.
