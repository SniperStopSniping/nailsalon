# D6-R1 inactive implementation evidence

This is local implementation evidence, not activation approval or proof of Stripe's remote behavior. Owner authorization excludes push, merge, deployment, activation, live financial operations and shared databases. R2 has not started.

## Identity and sources

Branch: `agent/d6-r1-inactive-20260912`. Base: `1a5cc8403ab17f79646f95dc967d450a3ff2f871`. Exact delivery commit is recorded in the accompanying local handoff after commit. Source hashes, independent READY review identity, pre-edit ownership manifest, and final main drift are in [IMPLEMENTATION-MANIFEST.md](IMPLEMENTATION-MANIFEST.md).

Review-tested `c0dcda9d` → start main `1a5cc840`: release metadata only. Main later advanced to `58c49c98` (booking palette continuity); no payment/migration/R1 overlap and no new migration allocation. This branch does not include that unrelated presentation commit.

## Local test boundary

Node 20.19.4 and committed lockfile; dependencies installed with `npm ci --ignore-scripts`. A task-owned PostgreSQL 16 cluster listened only on 127.0.0.1:55432, with database and role `luster_e2e_ci_disposable` / `luster_e2e_ci`, disposable application identity and explicit opt-in. Repository static target validation and live session attestation ran before migration/tests. Independent pool connections execute actual repository transaction helpers. No shared database URL or provider credential was used. Unit/build checks used repository CI placeholders, PGlite and no DATABASE_URL/Redis.

The signed webhook tests execute the actual POST route and real Stripe signature generation/verification; legacy refund application is isolated in that R1 suite and separately covered by the actual legacy PostgreSQL suites and full regressions. Observer tests use scripted provider responses. Four adapter tests exercise the actual production read adapter with scripted pinned SDK DTOs. Ten route-authority tests execute the actual refund POST, money guard and owner guard, with scripted session/Clerk identity, DB query/lookup and legacy lifecycle seams; they cover guest, staff-only, collaborator, wrong-salon owner, development override, super-admin impersonation refusals, admitted owner and matched super-admin, and current Clerk owner identity. No remote provider request was made.

## Requirement-to-test map

All R1 integration cases are in `src/libs/deposits/shadow.concurrency.integration.test.ts`; named T identifiers refer to R0-v2's R1 legs only.

| Requirement | Executed evidence |
|---|---|
| T01 receipt/crash/retry-horizon recovery; independent consumers | Signed route receipt survives legacy crash and old receipt age; legacy terminal/retention does not remove shadow row; shadow-first/duplicate/pause/replay cases; receipt persistence failure occurs before legacy dispatch/acknowledgement; unsupported/unattributed evidence remains enumerable |
| T02 bounded scheduling progress | Eligibility before limit, leased prefix, finite cohort exceeding batch across tenants/accounts/classes, unchanged/incomplete due advancement; continuously replenished multiclass noisy backlog cannot starve quiet tenant/discovery; four-page checkpoint resumption |
| T03 stale workers / dirty generation | Independent simultaneous claims, lease reclaim, reversed actual worker responses, legacy-row fingerprint drift, receipt during read, first-charge/charge-only receipt race using live PostgreSQL advisory-lock barriers; prior pending receipt cannot regress current authoritative success |
| T05 complete multi-refund evidence | Every distinct succeeded ID summed; pending/action-required/failed/canceled/unsupported/duplicate/foreign IDs retained or blocked; known ID omitted from list stays incomplete through exact retrieval/resumption; capped refund/dispute pages cannot certify; original charge capture/amount/refund totals checked |
| T09 legacy authority / command history | Immutable import keeps original epoch, unknown body/key facts and unresolved obligation; engine constrained to legacy; full legacy deposit row unchanged by observation; no provider create; legacy receipt consumer independent |
| T10 deadlines / resumable reads | Shared deadline/cancellation, interrupted page checkpoint, independent connection takes payment locks during provider callback proving reads are outside transaction locks; original collection revalidated on resume; bounded page batches |
| T17 identity | Invalid signature; wrong tenant/account/mode; exact original binding and deauthorization during read; contradictory identity cannot be masked by dispute reason; no foreign object facts/certificate; diagnostic joins scoped; actual route/owner-guard role matrix in `shadowAuthorityRoutes.test.ts` |
| T18 mandatory atomicity | Injected receipt and observation persistence failures roll back admission/progress/facts/certificate; no success acknowledgement before durable receipt |
| T20 minimal diagnostics | Counts, ages, due/checked/complete progress, reasons, bounded items plus aggregate totals, unattributed receipts, original recorded amount/currency/source and unknowns, implementation reviewer/evidence-only next step; CAD-only legacy guard preserved |
| T21 migration / coexistence / retention | Empty disposable DB runs migrations; interrupted additive migration transaction rolls back and retries; model/SQL column census; schema-absent financial-family receipt fails closed while unrelated route dispatch works; immutable evidence constraints; legacy deletion, actual purge and group reset preserve evidence and existing eligibility decisions |
| T25 dispute support | All five dispute lifecycle/principal event families durably invalidate; pre-enrollment/charge-only receipts cannot be lost; named dispute refund failure codes refresh original collection; previously observed dispute cannot disappear; closed/provisional debit/fees never invent principal reimbursement |

## Discriminating mutants

`scripts/d6-r1-mutations.mjs` requires an attested disposable target through the real suite, runs a full baseline, applies one mutant, requires an actual assertion failure, restores the exact original SHA256, reruns its control, then runs the full restored suite. Mutation runs use a second task-owned disposable worktree so implementation files remain intact.

Nine controls: remove receipt capture, remove replay, remove stale fence/version/lease checks together, remove dirty-generation check, ignore pagination completeness, replace fair ordering, ignore account/mode, remove dispute capture, remove account evidence advisory lock. The fence mutant is explicitly compound; it is not evidence that one predicate independently suffices. Filtered tests in targeted mutant runs are intentional; every baseline/final full R1 PostgreSQL run must execute 32 with zero skips.

## Failures found and repaired / test limitations

- Initial full suite:12 failures (11 preview fixture migration-count/tag pins and one hold-writer exact-list guard). Updated only exact compatibility pins; focused 42 passed. The subsequent full run cleared these failures.
- Early fence mutant survived because first-charge learning also rejected the stale response. Strengthened the fixture to establish charge identity before competing claims. It then failed for the intended stale-result assertion.
- Early account-lock mutant survived a timing-dependent test. Replaced sleep-based ordering with database barriers. One intermediate control used cached `pg_stat_activity` inside a transaction and failed; replaced it with live `pg_locks`. The control and mutant now discriminate.
- Added actual adapter tests caught the pinned Refund DTO's absent `livemode`; scope now derives from original-account request plus verified PI/charge mode. Contradictory returned mode still rejects.
- Initial role-matrix review found a duplicated guest/staff setup and invalid actor provenance despite passing assertions. Final fixtures supply the real staff cookie, valid typed actors, matching impersonation assertions, and a scripted Clerk owner path; the corrected 10 cases passed and were re-reviewed.
- A diagnostic fixture attempted USD on legacy CAD-only principal and was rejected by the existing constraint. The final test asserts that refusal; no schema guard was weakened and no foreign principal fact was fabricated.
- A full rerun and a focused retry while a build was competing for resources hit existing 5000ms PGlite initialization timeouts in `nonProductionDatabaseGuard.test.ts`. The subsequent two-worker full run passed all 38 guard tests but hit a different 5000ms timeout in the unchanged public manage-link booking retry-provider case:653 files/7655 tests passed, one failed,18 files/207 tests skipped and one TODO. The manage-link timeout also reproduced on the unchanged 1a5cc840 baseline in a separate task-owned worktree. Its fixed fixture reached 2026-09-12 18:00UTC during this session; production correctly rejected a past appointment before the provider callback. The fixture year alone was moved to 2099, retaining assertions, barrier and 5000ms timeout. No production booking/email logic changed. The earlier database-guard timeout cleared in the isolated 38-test run; resource contention remains only a plausible explanation for that separate failure. Final isolated75-test and single-worker full-suite runs passed, as recorded below.
- The first single-worker full run cleared the prior failures but exposed an unchanged reminder-action test race: it waited for POST dispatch and immediately asserted the banner was removed, before asynchronous response handling/React state could finish. That file passed in an isolated baseline run, so this is not claimed as a deterministic baseline failure. The same expected DOM assertion now uses existing `waitFor` with its unchanged default timeout; request assertions and production component are unchanged. Focused14, appointment-regression103 and final full-suite reruns all passed.
- A type check run concurrently with Next build raced generated `.next/types` deletion (352 missing generated-file errors). Final build and type checking run sequentially. Earlier missing runtime/Clerk configuration failures were corrected with repository CI placeholders, never real credentials.
- The first `npm run lint` inspected unchanged HEAD and selected no files. Explicit ESLint covered all changed source before commit; the standard changed-graph command is rerun after local commit.

The ordinary full suite intentionally has optional database/service/integration skips and existing TODOs. Required D5/D6/R1/client-stat PostgreSQL suites are executed separately with required flags and zero-skip markers; ordinary-suite skips are not substituted for that evidence. Mobile T24 belongs to R3/R4. R1 changes no browser-facing booking/admin journey, and no deposit/refund Playwright journey exists in `tests/e2e`; mobile Playwright was not run for this inactive server/data change. No remote test-mode contract or hosted preview was exercised; these are later authorized gates.

### Ordinary-suite skip inventory

| Group | Tests | Reason / disposition |
|---|---:|---|
| Required deposit/refund/R1/calendar/client-stat PG files | 51 | Ordinary run has no `CONCURRENCY_TEST_DATABASE_URL`; all five files separately executed with required flags,51 passed/zero skipped |
| Other existing PG concurrency files: appointments route, integration outbox, client lifecycle, booking-page lifecycle, approval expiry, booking entitlement override, outbox scope-clean mutants, billing credit reservations, communication dispatcher, Stripe Connect, portfolio media | 113 | Explicit disposable PostgreSQL URL/confirmation absent; unrelated to R1 changes; no PGlite substitution for concurrency claims |
| Dedicated client-lifecycle migration and directory-query files | 39 | `CLIENT_LIFECYCLE_TEST_DATABASE_URL` and disposable confirmation absent |
| Client deletion real-PG archive subgroup | 3 | Optional dedicated PostgreSQL target/confirmation absent; its eight other cases ran |
| Public-booking rate limiter real-Redis subgroup | 1 | Loopback `REDIS_URL` absent; its seven guard/unit cases ran |
| Catalog-preset architectural guard | 1 TODO | Existing explicit `it.todo`; no preset feature exists, so no vacuous assertion is claimed |

This accounts for 207 infrastructure skips and one TODO. Eighteen complete files are gated; partial groups are reported above. No R1-required concurrency case was skipped in its mandatory run.

## Inactive financial behavior

The only existing runtime integration is a verified receipt hook before legacy webhook claim. All added persistence is under `deposit_shadow_*`; no legacy observation helper is reused as a shadow writer. No refund/charge mutation API exists in the adapter. Legacy refund creation/application, credit, forfeiture, booking, waiver/release, notification and purge modules are unchanged. Tests verify legacy row equality and real purge/reset decisions. The fixed `legacy` engine constraint rejects repaired ownership; certificates say `financialAuthority:false`; no existing money reader consumes them. No hosted scheduler, activation flag, deployment or live migration was added/run. A capture/schema failure intentionally prevents financial-family acknowledgement before evidence durability; this is a rollout compatibility consideration, not permission to deploy R1.

## Review handoff and residual boundaries

A separate read-only high-risk reviewer reviewed the protocol, scope and fixes. Final delivery still requires the user's implementation review. Retention/legal/privacy policy, historical inventory, remote provider contract, operational capacity and integrated rollback/activation remain R5 prerequisites. R2 execution, R3 tender/booking/credit and R4 usable operator workflows remain unimplemented. Existing legacy financial defects remain; inactive R1 does not certify current production safety.

## Final execution record

| Command / evidence | Result |
|---|---|
| `npm ci --ignore-scripts` | Passed using Node 20 and committed lockfile |
| Required PostgreSQL command below | 5 files /51 passed, zero skipped (`d6-r1-concurrency-delivery.log`) |
| `D6_R1_EVIDENCE_DIR=... node scripts/d6-r1-mutations.mjs` in isolated mutation worktree | All 9 assertion mutants killed; every restored control and full 32-test final suite passed; delivery production hashes match recorded originals |
| `npm run test:appointment-regression` | 8 files /103 passed; rerun passed after final async-test correction |
| Focused compatibility suite | 42 passed after exact pin fixes |
| Actual adapter DTO tests | 4 passed |
| Real route/owner-guard authority matrix | 10 passed; no live auth/provider claim |
| Isolated final rechecks (DB guard, manage-link fixture, authority, adapter) | 4 files /75 passed; original timeouts unchanged |
| Explicit ESLint over all changed source/scripts | Passed |
| `npm run build` | Passed on final runtime code (`d6-r1-build-delivery.log`) |
| `npm run check-types` after build and after final test additions | Passed (`d6-r1-types-delivery.log`, `d6-r1-types-complete.log`, `d6-r1-types-final-reviewed.log`) |
| `npm run security:check-secrets` with new files staged | Passed after final additions,2465 tracked files and465 generated files scanned; one commit reviewed |
| `git diff --check` | Passed |
| Two-worker full rerun | One expired-date manage-link timeout;7,655 passed/207 skipped/1 TODO (`d6-r1-full-vitest-delivery.log`) |
| First single-worker full rerun | One async reminder assertion race;7,665 passed/207 skipped/1 TODO (`d6-r1-full-vitest-single.log`) |
| Final `npm run test:all -- --maxWorkers=1 --minWorkers=1` | Passed:655 files,7,666 tests;18 files/207 infrastructure skips and1 existing TODO; zero failures (`d6-r1-full-vitest-final-reviewed.log`, exit0) |
| Standard `npm run lint` after local commit | Passed including final test-only additions (`d6-r1-lint-complete.log`) |

Required PostgreSQL command (Node 20, disposable target/attestation, `D5_CONCURRENCY_REQUIRED=true`, `D6_CONCURRENCY_REQUIRED=true`, `D6_R1_CONCURRENCY_REQUIRED=true`):

```sh
npx vitest run --no-file-parallelism \
  src/libs/deposits/depositRefund.concurrency.integration.test.ts \
  src/libs/deposits/deposits.concurrency.integration.test.ts \
  src/libs/deposits/deposits.d5Calendar.concurrency.integration.test.ts \
  src/libs/deposits/shadow.concurrency.integration.test.ts \
  src/libs/queries.clientStats.concurrency.integration.test.ts
```

All five exact CI markers were present: D6 10/0, D5 deposits 5/0, D5 Calendar 3/0, R1 32/0, client-stat 1/0. The task-owned PostgreSQL cluster was stopped successfully after these runs. Logs, earlier failures, mutation result JSON and reproducibility wrappers are archived under `/Users/me/Documents/luster-d6-r1-implementation-20260912`; final archive hashes and commit identity accompany the handoff.

Final disposition: required R1 local acceptance completed. Separate source/test reviews found no remaining blocking finding after the documented corrections. This remains inactive code requiring implementation review, not activation approval. No push, merge, deployment, live Stripe/account access or shared-database operation was performed. The Owner checkout was not modified by this task.
