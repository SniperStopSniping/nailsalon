# Customer payment preparation, synthetic settlement and rehearsal

Customer collection remains disabled. None of these paths creates a provider
session, charges or refunds real money. Preparation and local rehearsal do not
write canonical appointment money. A separately gated internal synthetic test
seam now projects fixture captures into actual tender/tip/cache tables.

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

## Internal synthetic capture settlement

`settleSyntheticCapture.ts` is an injected-DB fixture seam, not a route or provider
adapter. Both preparation enablement and the separate literal
`CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED=true` are required. Production NODE_ENV,
APP_ENV and VERCEL_ENV markers fail closed. Only `source: synthetic_test`, test
mode and a known immutable prepared quote are admitted; a foreign original
account is rejected before attribution to a salon.

Migration `0116_customer_payment_synthetic_capture.sql` adds immutable capture
and event receipts. They preserve actual gross/currency/fee, quoted principal/tip/
fee, original capture time, processing time and a unique account/mode/intent.
Event replay compares immutable content and cannot project a second tender.
Capture/event update or deletion is refused. Restrictive foreign keys prevent
silently deleting the quote, appointment or canonical marker beneath money history.

Every accepted capture has an `appointment_payment` marker:
`cpay_<captureUUID>`, reference `customer_payment_capture:<captureUUID>`, method
`online`, recorded by `system`. Tender `recordedAt` is the immutable capturedAt,
while capture `recordedAt` is processing time. Valid current source/capability/
account/expiry evidence produces an active gross tender and matching tip/cache.
Appointment status and paymentStatus scalars remain unchanged. Late, cancelled,
revoked, stale, duplicate-distinct or amount/currency-mismatched captures are held
for review with a voided marker and no appointment money/lifecycle mutation.
They remain captured facts, never an inferred zero-money state.

The writer locks the appointment first, pins the salon FK with KEY SHARE NOWAIT,
then pins policy/capability/account and item sources, and checks the fresh clock
after waits. Failure of the initial FK pin returns retry-required without any
accepted capture/acknowledgement; the synthetic driver must retry. A future
provider inbox must retain received evidence independently of this transaction. Salon SHARE contention is isolated
in a savepoint and held for review on lock-unavailable; unrelated DB failures roll
back and require retry. Capture, receipt, marker and any tip/cache update commit
atomically. Provenance-aware canonical readers verify tagged tender and refuse
unresolved markers. The accompanying `0117_customer_payment_mutation_guards.sql`
provides DB-level financial/lifecycle/deposit defenses for indirect writers.

This is synthetic settlement infrastructure only. There is no capture API, real
provider receipt verification or automated reconciliation. The separate internal
synthetic refund seam below does not execute provider refunds. No
migration has been applied to an application database as part of this work.

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

## Required before real provider collection

- Implement a provider adapter that independently verifies actual client and
  account test mode, rechecks authorization and every financial source, and
  persists a recoverable operation/outbox boundary before provider calls.
- Reconcile canonical `appointmentPaymentLedger.ts` tender and
  `appointmentDepositFinancials.ts` credit before any collectible balance decision.
  Preserve required deposits and legacy-paid ambiguity. Never represent a full
  prepayment as a legacy deposit or count the same capture twice.
- Extend the synthetic atomic settlement and ownership/provenance guards to
  signature-verified provider evidence. Preserve prepaid tips at checkout and
  final invoice; late success must not revive released appointments.
- Extend synthetic refund allocation and collection-hold protections to verified
  provider evidence and invoice credits so refunds do not reopen receivables. Preserve gross capture history and
  historical reporting rather than relying on current void-and-replacement rows.
- Retain signature-verified webhook receipts before processing. Match event
  account, mode, session, intent, amount, currency, fee and metadata. Redirects
  are not evidence. Customer refunds and application-fee refunds remain separate.
- Verify each future provider/refund writer against the attested disposable
  PostgreSQL target. Preparation, synthetic capture and synthetic refund
  concurrency verification are recorded below; none certifies a future
  provider/refund writer. PGlite
  serializes one connection and cannot prove PostgreSQL lock behavior.

Ordinary legacy rows remain on their existing paths. Reserved synthetic capture
markers receive stricter provenance and mutation protections. This does not enable
customer collection or a live payment adapter.

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


## Opt-in PostgreSQL synthetic settlement concurrency gate

`settlement.concurrency.integration.test.ts` uses the same unchanged disposable
server guard and attests all four physical sessions. It accepts only
`CUSTOMER_PAYMENT_LEDGER_TEST_DATABASE_URL`; an ambient application URL is never
used. Supply that URL privately to a newly provisioned dedicated disposable
cluster, along with `LUSTER_DISPOSABLE_DATABASE=true` and any required container
attestation. Then run:

```sh
CUSTOMER_PAYMENT_LEDGER_PG_REQUIRED=true \
  /usr/local/bin/node node_modules/vitest/vitest.mjs run \
  src/libs/customerPayments/server/settlement.concurrency.integration.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

No dedicated target produces eleven explicit skips; required mode with no target
fails before connecting. Invalid supplied targets fail validation. The suite
applies the actual migration journal, including immutable capture and mutation
guards. Its immutable money fixtures deliberately cannot be deleted by ordinary
cleanup. Tear down the entire private cluster afterward; never disable the guards
or run against a shared database.

Eleven cases cover simultaneous identical captures, distinct intents for one
quote, salon KEY SHARE/FOR UPDATE retry without acknowledgement, salon SHARE/FOR
NO KEY UPDATE contention retaining review evidence, receipt replay under exclusive
salon contention, and service/add-on/deposit insertion races against the parent
appointment lock. Two legacy purge cases additionally prove typed refusal before child deletion under appointment contention and successful ordinary unmarked purge without contention. A client-first writer regression observes its real salon-blocking chain, verifies typed purge refusal without deleting rows, and proves the competitor proceeds after purge rollback. These exercise real PostgreSQL blocking and NOWAIT behavior.

Latest verification: all eleven synthetic settlement/purge cases and all five preparation
cases passed serially on PostgreSQL 16.15 against the full migration journal.
The new private loopback cluster was stopped and deleted, including its ephemeral
password. No existing database, service or provider was contacted. This verifies
these fixture paths, not production readiness or real provider receipt handling.


## Internal synthetic refund evidence and permanent collection hold

`recordSyntheticRefund.ts` uses an injected DB and requires the additional literal
`CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED=true`, plus both preparation and ledger
flags. Production remains denied. There is no refund API or provider operation.
Only posted CAD synthetic captures can receive matching account/intent/test-mode
refund evidence. Customer and fee refund inputs must explicitly say succeeded;
requested, pending or failed outcomes are not successful money movements.

Migration 0118 preserves immutable customer refunds with original observed amount,
principal/tip allocations, occurrence time, processing time and event fingerprints.
Exact event/movement replay has no second effect. Whitespace-only external
identifiers are rejected before database access and by SQL checks; valid IDs are
never trimmed or rewritten. Valid cumulative allocations
reduce the appointment cache atomically, leaving the original gross tender,
capture, invoice tax and tip unchanged. Invalid or over-limit allocations remain
held review facts without reducing trusted credit or inventing negative credit.
Any customer refund permanently holds collection and financial/lifecycle actions.
There is no hold-clearing or credit-note workflow in this slice.

SQL independently locks the appointment and validates identity/cumulative bounds.
An AFTER INSERT trigger projects cache from gross nonvoided tenders minus applied
refunds. The appointment guard permits only that exact derived cache plus harmless
notes/contact edits under hold, with monotonic updatedAt. There is no bypass GUC.
Raw tender mutation checks lock parents before reading refund holds. Correctly
reserved, voided review markers can still preserve newly observed late captures;
they never create additional booking credit. Ordinary legacy rows without markers
do not query refund tables from these guards.

Application-fee binding and successful fee-return receipts are separate immutable
records. A customer refund never implies a fee return. Missing binding, preceding
capture time, policy-excess or cumulative-excess fee evidence is retained for
review. A later fee binding cannot silently turn an old review receipt into an
applied receipt. Future explicit immutable reconciliation remains necessary.
Observed successful review movements remain cash-reporting facts even though they
are not trusted booking-credit projections. Unknown/foreign account evidence needs
a future independent inbox and is not attributed to this salon.

`refund.concurrency.integration.test.ts` requires a separately provisioned private
attested disposable PostgreSQL target via `CUSTOMER_PAYMENT_REFUND_TEST_DATABASE_URL`
and `LUSTER_DISPOSABLE_DATABASE=true`. Run with
`CUSTOMER_PAYMENT_REFUND_PG_REQUIRED=true`, Node24, Vitest `--maxWorkers=1
--no-file-parallelism`. Missing target skips; required missing target or invalid
supplied target fails before connection. It attests every physical session and
uses the actual migration journal. Immutable fixtures require whole private-cluster
teardown, never disabling their SQL guards.

Seven PG cases cover duplicate/partial/overflow customer refund races, cumulative
independent fee refunds, and raw tender INSERT/UPDATE/DELETE fencing around refund
holds. The synthetic writer PGlite suite additionally covers rollback, strict
identity, production gates, late capture retention, fee-before-binding and
policy-excess factual evidence. None of these tests certify real provider input.

## Explicit synthetic review decisions and credit-aware zero-balance reads

Migration 0119 and `recordSyntheticCreditDecision.ts` add immutable cumulative
obligation-credit decisions for completed, finalized CAD invoices with exactly
one eligible synthetic capture/tender, fully applied customer refund allocations,
and no deposits or unknown/review customer cash. They do not clear the ordinary
refund action/SQL hold, change cash, modify the original invoice or create a legal
tax document. Customer service/tax/tip credit is explicit, bounded by original
amounts, and equals actual cumulative customer principal/tip refunds.

The shared fifth flag `CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED=true` requires
base preparation/ledger nonproduction gates. Recording decisions does not require
the refund-write flag. Preview/new-write authorization receives a separately
supplied genuine server-auth actor and verifies current owner membership under
the appointment lock. The exposed owner surface must use non-impersonated owner
authentication; request payloads never grant actor authority. SQL independently
checks membership, tenant/source identity, allocations and evidence revision, but
a database actor ID by itself is not proof of an authenticated browser session.

Each decision stores original monetary evidence, SQL-authoritative revision,
separate pure-projection fingerprint, immutable actor/reason/request, parent
decision, cumulative allocations and incremental allocations. The parent must be
the unique current chain head. Incremental credit equals current minus prior
cumulative credit, with no negative components or retroactive service/tax
reclassification. Never sum cumulative snapshots as additive credits. A repeated
request returns the exact original decision; a different payload conflicts.
Internal exact replay can acknowledge historical decisions after membership
revocation, but never grants new authority or claims a stale decision is current.

SQL revisions bind finalized monetary invoice, customer captures/refunds/tenders
and absence of deposits. Notes/contact/updatedAt, duplicate transport receipts,
and independent application-fee movements do not change the customer obligation
revision. New customer cash invalidates the prior resolved view automatically.
The next decision must explicitly review the new evidence. Fee cash remains
separate, including review disclosures, never customer obligation credit.

`readCurrentCustomerPaymentCreditResolution` is a trusted internal tenant-scoped
read. It requires base ledger/preparation nonproduction gates, independently of
write flags, and holds a shared appointment lock for a consistent source snapshot.
It validates the complete decision chain and both evidence fingerprints before
returning an adjusted zero-balance read. It never authorizes collection, and the
ordinary money/lifecycle mutation paths remain blocked.

`creditDecision.concurrency.integration.test.ts` uses the existing attested private
PostgreSQL target contract with dedicated `CUSTOMER_PAYMENT_CREDIT_TEST_DATABASE_URL`
and required-mode flag `CUSTOMER_PAYMENT_CREDIT_PG_REQUIRED=true`. Missing URL
skips; invalid/required-missing targets refuse before connecting. Four cases cover
same/different request contention, a refund committing ahead of a waiting decision,
and owner-membership revocation contention. The actual migration journal is used;
immutable fixtures require teardown of only the newly created private cluster.
Latest native PostgreSQL16.15 verification passed all four credit cases and all
23 prior preparation/capture/refund cases. No provider or application DB was used.
