# R1 operation deadline repair

Reviewed parent: `e2c4057464b1e57b36ced4ebce37ee85f80fc67a`.
Branch: `agent/d6-r1-deadline-repair-20260912`, isolated worktree at `/Users/me/nailsalon-worktrees/d6-r1-deadline-repair-20260912`.
Scope: N1 acquired binding-lock idle lifetime and N2 known-refund SQL lifetime only. The six previous fixes remain intact.

Pre-edit ownership manifest: operation-local PostgreSQL 16 timeouts and recoverable expiration in shadow transactions/reads; no schema, migration, legacy financial writer or activation changes. Keep atomic binding history, independent evidence, tenant scope and fences. Receipt admission errors remain failures. Use the exact reviewer boundaries before changes, then maintained deadline/recovery tests plus required R1 acceptance.

Current main at start: `adf041f4a2da8b832ede4060bf7617d7f9d0a899`. No rebase planned; inspect drift/migrations at delivery. Tests use only guarded disposable local PostgreSQL and scripted provider responses. Independent final verification required.

## Repairs

- N1: every affected shadow statement receives PostgreSQL 16 `SET LOCAL` statement and idle-in-transaction budgets computed by the server from the absolute operation deadline. Each receives one third of remaining time, covering the idle gap before SQL, active SQL and idle gap afterward. Refreshing these budgets also covers the callback-to-COMMIT gap. The global SHARE barrier and full binding-history/fence checks are unchanged. A dedicated checkout from the existing guarded pool listens for fatal idle termination and destroys/releases that client once, even while its application callback remains paused. Deadline SQLSTATEs are retained before Drizzle rollback can mask them. Expired finalization returns stale and leaves durable recovery state.
- N2: all three known-refund queries run through that bounded transaction, using the observer's read deadline (`claim.deadline - 1500ms`) to preserve finalization time. PostgreSQL cancels blocked SQL; this is not merely a caller-side Promise race. No global PostgreSQL configuration or shared database helper changes.

Timeouts can deliberately expire earlier than the full deadline to reserve both idle gaps. Pool acquisition retains the existing runtime timeout; an expired queued checkout cannot start SQL. These repairs establish bounded acquired-lock/active-query lifetime, not a hard bound on COMMIT/network acknowledgement or an unavailable database server.

## Before-fix evidence

The exact three archived reviewer boundary tests were run at the reviewed parent before runtime edits. `before-fix.log` records two assertion failures and the passing outside-transaction reclaim control, zero skips: an unrelated binding writer remained blocked 718ms beyond the matching lease deadline; both known-refund SQL queries remained active 617ms beyond the worker deadline, with two finalizers waiting for the two pool slots. These failures reproduce local PostgreSQL behavior only.

## Isolation and migration strategy

Changes are confined to the shadow transaction/read path, its transaction-opener census, new regressions, CI coverage and this record. Shadow objects, raw observations, receipts, leases and consumer ownership are unchanged. The original six repairs remain in place. No SQL UPDATE/INSERT target is added to legacy financial tables; certificates retain `financialAuthority:false`. Legacy processing remains the financial/booking/credit/forfeiture/waiver/notification/purge authority. No provider mutation, hosted worker, activation or R2/R3/R4 path is added.

All migrations, journal entries and models remain byte-for-byte unchanged from the reviewed parent. Migration 0076 stays additive and no historical amount, identity or fact is invented. Final fetched main at drift inspection is `5bb93dc51c44f6314a12baa9f10132e4e8fab1a6`: booking presentation, onboarding/media and release metadata changes, no repair-runtime/binding/DB/CI/migration overlap, and dependency versions unchanged. Main still ends at 0075. No merge or rebase required.

## After-fix acceptance

Evidence archive: `/Users/me/Documents/luster-d6-r1-deadline-repair-20260912`.

`required-pg-final.log`: **78 passed in seven files, zero skips and no unresolved timeout** (32 original R1 + 21 previous repairs + 6 deadline cases + 19 legacy/calendar/client-stat races), 38.57s. Exact count markers are enforced; CI now includes the six new cases.

| Boundary | Maintained evidence from the combined run |
| --- | --- |
| N1 acquired idle SHARE lock | Unrelated writer completed **916ms before** the genuine 1400ms claim deadline, while the finalizer was still paused. Both pool clients could be checked out before resuming it. Resumption returned stale/incomplete; a newer fence subsequently certified. |
| N1 active SQL then idle gap | Real `pg_sleep(0.2)` followed by the paused acquired SHARE lock: unrelated writer completed **1579ms before** the 2700ms deadline. Resumption remained recoverable. |
| N2 known-refund object read | Both actual SELECTs were observed waiting on a lock, then ended in **394/392ms**, at least **780ms before** the observer read deadline. |
| N2 legacy-refund-ID read | Both actual SELECTs were observed waiting, then ended in **395ms**, **785ms before** the read deadline. |
| N2 receipt-refund-ID read | Both actual SELECTs were observed waiting, then ended in **394/395ms**, at least **787ms before** the read deadline. |
| N2 recovery and scoped settings | With each table blocker still held, both observers returned stale/incomplete, no application SQL remained active and no pool waiter remained. After release, fresh observation certified. Both pooled sessions retained their original timeout settings. |
| Existing suspension control | Pause outside a transaction past a genuine lease, reclaim with a higher fence, certify, then reject the old observation without replacing the certificate. |

The original six fixes are exercised by the unchanged 21-case repair suite: unresolved ID-less history, binding deauthorization/history races, real multi-tenant batch fairness, durable replay contention/recovery, duplicate identity quarantine and tenant-private diagnostics. In this combined run the four-slow/one-quiet worker rounds took 1224/1218ms under 2700ms budgets. Original R1 acceptance also retains receipt/crash/consumer independence, dispute/dirty/fence invalidation, full refund evidence, actual purge/reset coexistence, migration rollback and legacy-row equality.

`focused-regressions.log` and final `focused-delivery.log`: 73 adapter/route-authority/legacy-refund/lifecycle/binding/writer-boundary cases passed. `build-final.log`: production build passed compilation, type validation, page data, static generation and traces using placeholder configuration without a database URL. Only this worktree's completed webpack cache was removed after compilation to preserve local disk space; the build did not fail. Normal cache/Browserslist and absent optional local-service warnings remain.

Iterative failures are not counted as passing evidence: `types-initial.log` identified unused copied fixture imports/helpers, which were removed. An intermediate strengthened activity probe read PostgreSQL's cached activity snapshot inside the blocker's transaction and failed to see the target queries; a separate independent monitoring connection fixed the fixture. That failed probe was observed during iteration but its overwritten temporary log was not retained. The final test explicitly sees each real SELECT waiting on `Lock`, and asserts its end timestamp is no later than the read deadline. No acceptance assertion or operation deadline was relaxed.

Self-review and read-only high-risk review covered binding atomicity, stale workers, error normalization, immediate dead-client disposal, LOCAL setting scope, evidence preservation and tenant/financial isolation. No further concrete N1/N2 runtime defect was identified. These reviews are not independent implementation acceptance.

All testing used Node 20.19.4 and guarded disposable PostgreSQL 16.15 on loopback with independent connections, runtime-size two-connection contention pools, real repository helpers and scripted provider responses. Nothing here proves Stripe remote behavior or hosted throughput. No live Stripe, shared database, schema operation outside disposable tests, push, merge, deployment or activation was performed. Independent verification remains required.

Final verification: `types-delivery.log` and `lint-final.log` passed. `mutations.log` records all nine existing mutants killed by assertion failures, every restored control green, and full 32-case baseline/final runs green. Source restoration hashes are in `mutants/results.json`. Filtered mutant runs intentionally exclude unrelated cases; the required 78-case run has zero skips. The disposable cluster was stopped after PostgreSQL/mutation testing. `secrets-precommit.log` records a passing staged/tracked secret scan. Local commit identity and postcommit lint/secret results are recorded in the external delivery archive.
