# D6 R1 targeted repair record

Parent: `1d045dbb7a52a27900943cf2eb06d47ec21b57d2`.
Branch: `agent/d6-r1-targeted-repair-20260912` in a separate worktree.
Authoritative inputs: corrected R0-v2 and independent implementation REVIEW.md dated 2026-09-12. No activation or R2 work authorized.

## Pre-edit data/event/consumer ownership manifest

- Historical status/refunded-at markers join the existing immutable legacy-import evidence; no inferred refund ID, amount, key or request. Certificates fail closed on unknown history.
- Binding history is read under finalization locks; original account/mode is retained. Later deauthorization/reassignment cannot be bypassed by older rows.
- Actual batch observation gives bounded opportunities across tenant/account work. Retryable replay contention remains durable and shares the processing deadline.
- Every refund occurrence is identity-checked before duplicate handling or normalized writes.
- Tenant diagnostics expose only unambiguously scoped receipt evidence; ambiguous receipts remain in private administrator diagnostics.
- Legacy still owns all money, booking, notification, release and purge behavior. Receipt and shadow consumer progress remain independent of legacy event consumption.
- No new schema or migration change is planned. Migration 0076 and all prior migrations remain byte-for-byte unchanged.

## Drift

Fetched origin/main at start: `58c49c98201a7de67181db4b146cc5a2e393f324`; no payment/migration overlap since R1 base, journal ends at 0075. No rebase/merge necessary. The precommit recheck returned the same SHA. A postcommit fetch found `9dc4197800a3ae8d492860b272ee8a4df384729a` (onboarding cover-photo saving/retries, eight files including a guest-manage test fixture). It has no R1 payment, binding, CI or migration overlap and still ends at 0075. No unrelated rebase/merge is required. All 88 migration-directory files and the model directory remain unchanged from the reviewed implementation.

## Evidence

Evidence archive: `/Users/me/Documents/luster-d6-r1-repair-20260912`.

The unmodified reviewer counterexamples were copied into the repair worktree before production edits. `before-fix.log` records **six assertion failures and five passing controls**, zero skips, reproducing every review finding. `after-first-fix.log` records all eleven passing. Maintained strengthened cases reside in `shadow.repair.integration.test.ts` and retain those five controls.

| Finding | Repair and maintained evidence |
| --- | --- |
| 1 — historical uncertainty | Import admits `status=refunded` / `refunded_at` markers. Observation also retains ID-less markers in the same immutable legacy evidence command/attempt, with unknown amount/request/key/provider ID. Marker clearing cannot erase the uncertainty. Status-only, date-only, import, no-import and later-clearing cases block certificates. No R1 resolution/execution path is introduced. |
| 2 — binding deauthorization | Finalization locks account binding DML with a short SHARE table lock after payment locks, then reads all original-account history in a fresh statement. Foreign salon/mode history rejects; an actual live same-pair authorization is accepted; otherwise deauthorization defeats local-revocation history. Independent-connection insertion/update races and historical/local-only controls cover this. |
| 3 — batch fairness | Four bounded observation lanes claim one item immediately before observing it, rather than preclaiming an entire sequential batch. Persisted fair selection rotates unstarted tenants in subsequent batches. The claim and its legacy snapshot share a transaction whose SQL deadline reserves provider time; timeout rolls back service accounting. Real-worker slow/noisy, quiet-only, more-than-four-tenant and delayed-claim cases discriminate. |
| 4 — replay contention | Recognized PostgreSQL contention rolls back one replay attempt, durably defers its receipt where the row is available, then continues eligible unrelated work. A locked receipt remains pending/due if even deferral is contended. Replay has a bounded share of the total deadline; each SQL statement gets the remaining budget. Arbitrary persistence/admission failures still propagate. Recovery checks retain and subsequently replay the receipt and saved observation progress. |
| 5 — contradictory duplicates | Validate every occurrence before duplicate handling; any duplicate conflict quarantines the cycle from normalized object/cursor writes. Raw observation evidence remains append-only. Foreign PI/charge permutations and same-owner contradictory values cannot become last-wins facts. |
| 6 — tenant diagnostics | Tenant receipt count/list use the same attribution predicate. Account-only evidence requires exclusively matching salon/mode history. Reassigned/ambiguous receipts remain in the private administrator diagnostic, with amounts preserved; pagination cannot leak them into either tenant. |

Additional type-only maintenance: the existing migration acceptance callbacks explicitly await driver results, avoiding an incompatible PostgreSQL/PGlite result-union inference. SQL and assertions are unchanged.

Final required PostgreSQL command runs `depositRefund.concurrency`, `deposits.concurrency`, `deposits.d5Calendar.concurrency`, `shadow.concurrency`, `shadow.repair.integration`, and `queries.clientStats.concurrency`, with `--no-file-parallelism` and all D5/D6/R1 required flags. `required-pg-verified.log`: **72 passed in six files, zero skips, no timeout** (32 original R1 + 21 repair + 19 legacy/coexistence races). The original fairness timeout remains 5000ms; no acceptance timeout was raised. Re-eligible four-slow/one-quiet actual-worker rounds took 1211ms and 1209ms under 2700ms budgets; the quiet tenant certified in round two.

`focused-regressions.log`: **73 passed** across the actual adapter (4), route authority (10), legacy refund (25), lifecycle (11), Stripe binding (16), and writer-boundary (7) suites. The required PostgreSQL set also exercises legacy money behavior, receipt/consumer independence, stale fences, disputes, multi-refund completeness, migration interruption/rollback and actual purge/reset compatibility.

`mutations.log` / `mutants/results.json`: **nine mutants killed by assertion failures**, restored controls passed, baseline and final full 32-case R1 sets passed. Targets: receipt, replay, compound fence, dirty generation, pagination, fair selection, provider scope, dispute capture and account evidence lock. Runtime source hashes match the repaired delivery. Targeted mutant runs intentionally filter the other 31 tests; these are not required-suite skips.

`types-delivery.log`: type check passed. `lint-final.log` and `lint-repair-strengthened.log`: all five changed TypeScript files passed. `secrets-precommit.log`: staged/tracked scan passed. `build-verified.log`: **production build passed**, including compilation, type validation, page-data collection, static generation and traces. Normal cache/Browserslist warnings remain; no dependency change was needed. The completed compiler cache was also removed during the successful retry to preserve disk headroom. Postcommit lint/secret results are archived with the delivery identity.

Execution failures retained and resolved: the first local target attempt was rejected by the unchanged database guard because port 55434 is not approved; the repair-owned cluster was restarted on verified-free approved loopback port 55432. The initial combined run passed 50 cases but failed the D6 negative deadlock control because this newly created role lacked SET permission on `deadlock_timeout`; the PostgreSQL log identifies that permission error. A local `GRANT SET ON PARAMETER deadlock_timeout` enabled the existing control without modifying assertions. Iterative type errors in the new executor/test callbacks were fixed; the two existing migration callbacks now explicitly await their driver results. Two build attempts also failed with ENOSPC (one after successful compilation/type validation, one during compilation). Only disposable compiler caches created by this repair and the earlier R1 implementation run were cleared before the final retry. Source files, Owner files and other agents’ artifacts were not removed. None of these failed runs is represented as passing.

No broad unrelated Vitest, browser/mobile or remote-provider suite was run for this targeted server-only repair. All required scoped acceptance executed. Local PostgreSQL used repository static target validation and independent-session attestation before migration; all data/provider responses were synthetic, Node 20.19.4, committed dependency lockfile with the original R1 installed dependencies. The repair-owned cluster was stopped after testing.

Self-review covered tenant isolation, full account history, stale-worker/dirty fences, immutable unknown provenance, duplicate quarantine, replay durability and absence of legacy financial writes. A read-only high-risk reviewer inspected the final diff and 72-case log and found no remaining concrete defect within the six findings; it did not rerun tests or grant activation approval.

## Isolation and migration strategy

Only shadow runtime helpers, maintained tests, CI coverage and this record change. All normalized writes remain under `deposit_shadow_*`. The read adapter exposes no mutation API. Existing legacy routes/helpers remain the money/booking/credit/forfeiture/waiver/notification/purge authority; no hosted worker or activation switch is introduced. Certificates still explicitly carry `financialAuthority:false`. The original R1 signed-webhook receipt hook is unchanged.

No migration, journal, schema or historical financial row is modified. Existing migration 0076 stays additive, and historical unknowns remain unknown. The PostgreSQL acceptance includes actual purge/reset coexistence and unchanged legacy-row evidence. Local fixtures are synthetic; no Stripe account or shared/hosted database is used.

## Review limits and handoff

The SHARE lock briefly serializes binding writes across accounts; its waits are bounded and provider calls stay outside transactions. This is an inactive-foundation tradeoff to avoid altering legacy binding writers or migrations. Hosted capacity and alternative locking require a later authorized review, not activation here.

The tests prove progress under scripted provider stalls, independent database contention and bounded SQL delays. They do not prove Stripe remote behavior, production throughput, arbitrary host suspension, or a hard wall-clock bound on COMMIT/network acknowledgement. A 100ms post-claim margin is not a guarantee against suspension. All receipts/claims retain durable recovery state if execution stops.

R1 remains inactive and requires independent final implementation review. No R2/R3/R4 work, push, merge, deployment or activation is authorized by this delivery.
