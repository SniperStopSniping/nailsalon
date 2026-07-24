# Client Lifecycle Recovery and Split Plan

## 1. Executive recommendation

PR #55 must remain a draft, unmerged reference while its useful work is
restructured. It must not be rebased, extended, marked ready, deployed, or
merged.

The replacement sequence is:

1. Production lifecycle stabilization.
2. Edit Client only.
3. Archive and Restore.
4. Merge redesign.
5. Permanent deletion deferred.

After the stabilization release is production-verified, record a path-level
extraction manifest for the remaining feature PRs and close PR #55 as
superseded. Do not cherry-pick either of its large mixed feature commits
wholesale.

## 2. Immediate production risk

The urgency is **urgent stabilization**, not an immediate incident.

Production v1.33.0 is operating and the count-only audit found no known
migration-blocking rows. However:

- Production already has migration 0061 and one archived merged-source
  profile.
- The repository history on production `main` ends at 0060.
- The broad merged-source trigger can reject valid v1.33 writes.
- Existing writers and 0061 functions can acquire locks in opposite orders.
- The health endpoint does not prove that lifecycle schema is ready.
- Application promotion is not enforced as a migration-first process.

All lifecycle feature flags must remain disabled until stabilization is
deployed and verified. Increases in SQLSTATE `40P01`, `40001`, `55000`, lock
waits, retention failures, or merged-source write failures are incident
signals.

## 3. Recommended PR sequence

### PR 0 — Production lifecycle stabilization

- **Purpose:** Reconcile repository history with the immutable 0061 already in
  Production, add forward-only 0062 stabilization, make existing writers safe,
  and add schema-readiness and migration-first release gates.
- **Scope:** Exact 0061 adoption, 0062, terminal-client compatibility, shared
  lifecycle-active queries, deterministic PostgreSQL coverage, and additive
  health/readiness checks.
- **Exclusions:** No Edit, Merge, Archive, Restore, Delete, loyalty movement,
  reward movement, external identity merge, or unrelated product work.
- **Dependency:** Latest clean production `main`.
- **Expected size:** A focused medium PR dominated by migrations, tests, and
  narrow writer compatibility changes.
- **Review:** Independent database/platform and application/security review.
- **Gate:** Production-shaped rehearsal, current-app compatibility, all CI,
  Vercel Preview, and no unresolved Critical, High, or Medium finding.

### PR 1 — Edit Client only

- **Purpose:** Edit first name, last name, phone, email, and birthday with
  normalization, duplicate detection, alias preservation, and stale-write
  protection.
- **Exclusions:** Merge, archive, restore, delete, loyalty/reward movement, and
  external identity changes.
- **Dependency:** PR 0 production-stable for at least 24 hours.
- **Expected size:** Small.
- **Review:** Application/security and booking reviewers.
- **Gate:** Preview verification at desktop and exact 390x844, followed by
  controlled production enablement.

### PR 2 — Archive and Restore

- **Purpose:** Owner/admin archive and restore with a transactional outreach
  barrier and consistent reminder behavior.
- **Exclusions:** Merge, delete, reward/loyalty movement, and external identity
  changes.
- **Dependency:** Edit live and stable.
- **Expected size:** Small to medium.
- **Review:** Messaging/retention, Client Insights, and security reviewers.
- **Gate:** Deterministic archive/outreach races and a complete
  reminder/retention observation cycle.

### PR 3 — Merge redesign

- **Purpose:** Controlled, audited, idempotent merge with stable primary ID,
  deterministic locks, canonical reporting, and fail-closed financial and
  identity behavior.
- **Exclusions:** Reward-bearing or loyalty-bearing merges in the first
  release, external identity merge, permanent deletion, and privacy erasure.
- **Dependency:** Archive/Restore production-stable and reward identity design
  approved.
- **Expected size:** Medium, still materially smaller than PR #55.
- **Review:** Database/concurrency, financial/rewards, and security/auth.
- **Gate:** Independent review with no Critical, High, or Medium blockers.

### Permanent deletion

Ordinary permanent deletion is removed from the initial lifecycle roadmap.
Legal/privacy erasure is a separate audited workflow.

## 4. Stabilization PR file plan

The stabilization PR starts from latest clean production `main`.

### Mandatory history and schema files

- `docs/client-lifecycle-recovery-and-split-plan.md` records this approved plan
  and must be committed by itself before production-code changes.
- `migrations/0061_client_edit_merge_archive.sql` adopts the exact immutable
  migration already applied in Production.
- `migrations/meta/_journal.json` first adopts the exact existing 0061 entry,
  then appends 0062 in the later stabilization commit.
- `src/models/Schema.ts` receives only the minimum mappings needed for the
  already-present 0061 objects, followed by the 0062 capability mapping.
- `migrations/0062_client_lifecycle_stabilization.sql` contains the
  forward-only stabilization.

The exact 0061 adoption is a repository-history reconciliation, not a new
Production migration. Before committing it, verify the SQL file hash, byte
length, journal index/version/timestamp/tag, and expected schema-object
evidence. Stop on any mismatch.

### Stabilization support

- A small server-only lifecycle stabilization module provides terminal
  resolution, deterministic locks, and bounded retry.
- A private schema-readiness verifier validates migration/capability/catalog
  state.
- A count-only preflight validates existing lifecycle data without exposing
  PII.
- A migration benchmark measures the production-shaped upgrade and locks.
- `/api/health` receives only an additive aggregate readiness field while
  preserving every existing response field.

### Proven existing writers and reads

Only writers and shared reads proven to diverge or fail for the existing
merged-source state are eligible:

- Retention communication and campaign preparation.
- Appointment communication, review follow-up, cancellation, and update.
- Reward redemption.
- Client flag updates.
- Preferred-technician/staff resets.
- Shared client queries and Client Insights.
- Financial reporting and legacy Client Hub compatibility metrics.

Every production-code change requires focused regression coverage. No client
profile lifecycle action component or lifecycle action route belongs in this
PR.

## 5. Repository adoption and forward migration design

### Exact 0061 repository adoption

Current production-main repository history ends at journal index 60 while
Production already contains the exact 0061 migration record and schema. PR 0
must reconcile the repository before adding 0062.

The adoption commit must contain:

- The exact byte-for-byte
  `migrations/0061_client_edit_merge_archive.sql` matching Production.
- Journal index `61`, version `7`, tag
  `0061_client_edit_merge_archive`, timestamp `1784950000006`, and existing
  breakpoint value.
- Only minimum Drizzle mappings for existing 0061 objects.

The expected SQL SHA-256 is
`ec2ea523735b0a45b964ed78f6f56327c9019678c29e6e994f161a8b2a4f7731`.
The expected file size is 9,316 bytes. These values must be checked against the
approved count-only Production or production-clone evidence without printing
credentials or PII.

Do not regenerate, format, amend, renumber, or replace 0061.

### Added 0062 capability

0062 adds a private lifecycle capability/version marker. Version 2 with ready
state becomes externally visible only when the migration transaction commits.
The migration must not claim that an intermediate installing state can be
observed. A failed transaction leaves no ready version-2 capability.

Merge creation remains disabled in capability state.

### Replace function bodies, not trigger attachments

Use `CREATE OR REPLACE FUNCTION` to replace the unsafe 0061 function bodies
while leaving trigger attachments intact:

1. Merged-source mutation compatibility:
   - Allow existing non-lifecycle v1.33 updates.
   - Reject changes to salon, merge, or archive identity fields.
   - Do not silently redirect or swallow writes.
2. Stale-reference resolution:
   - Resolve only within the referenced salon.
   - Traverse a bounded chain.
   - Reject missing, cross-salon, cyclic, or excessive-depth targets.
   - Do not explicitly lock salon or client rows in the trigger.
3. Merge-transition enforcement:
   - Return immediately when lifecycle fields are unchanged.
   - Reject new merge transitions while merge writes are disabled.
   - Preserve same-salon and cycle protection without a salon-row lock.

### Constraints and indexes

- Preserve the existing validated same-salon constraint.
- Add no table-scanning constraint in 0062.
- Add no index unless a production-shaped
  `EXPLAIN (ANALYZE, BUFFERS)` proves it necessary.
- Any required concurrent index is a separate deployment phase and migration,
  not part of the atomic 0062 transaction.

### Transaction and retry

0062 is one short atomic transaction owned by the repository's existing
migration runner:

1. Apply short local lock and statement timeouts.
2. Add or update required private capability metadata.
3. Replace function bodies.
4. Assert required catalog state.
5. Publish version 2 ready as the transaction commits.

Do not add nested transaction handling inside SQL.

The migration/deployment wrapper retries the complete migration command at most
three times. Retry only:

- `40P01` deadlock detected.
- `40001` serialization failure.
- The explicitly approved PostgreSQL lock-timeout failure.

Use bounded jitter. Validation, permission, syntax, journal, checksum, and
catalog mismatches fail immediately.

### Rollback

Never add a down migration. If application deployment fails, retain 0062 and
use v1.33 only as conditionally safe emergency compatibility with:

- All lifecycle features disabled.
- No new merge or archive operation.
- Merged-source-targeted operations monitored.
- Stabilization restored as soon as practical.

## 6. Canonical lock order

Global rules:

1. Authorize without locking the salon row.
2. Resolve candidate IDs read-only.
3. Lock affected `salon_client` rows by ascending stable ID.
4. Lock aliases by
   `(salon_id, kind, normalized_value, salon_client_id)`.
5. Lock only dependent rows being mutated.
6. Never hold a dependent or identity lock and then request a client lock.
7. Stabilization triggers acquire no explicit salon or client row locks.

Dependent mutation order is:

`appointment -> client_communication -> retention_campaign -> reward ->
referral -> review -> fraud_signal -> salon_client_note`.

| Operation | Lock order |
| --- | --- |
| Edit | Terminal client `FOR UPDATE`, conflict clients sorted, aliases sorted |
| Archive | Terminal client `FOR UPDATE`, proactive communications, campaigns |
| Restore | Client and conflict candidates sorted, aliases sorted |
| Merge | Full client set sorted, aliases, then mutated dependents in global order |
| Retention communication | Terminal client `FOR UPDATE`, communication, campaign |
| Campaign preparation | Target clients sorted, communications, campaigns |
| Appointment creation | Canonical client `FOR UPDATE`, active appointments, insert |
| Review update | Terminal client if client state changes, appointment, review |
| Reward operation | Terminal client, aliases, rewards, referrals |
| Staff reset | Terminal clients in sorted batches |
| Identity/session creation | Canonical client, aliases, customer account, sessions |

PR 0 implements only compatibility behavior for existing operations. It does
not create Edit, Archive, Restore, or Merge transactions.

Application transaction retry is limited to three complete attempts for
`40P01` and `40001` with bounded jitter. Transactions that create a durable
side effect require an idempotency or uniqueness guarantee before retry.

## 7. Application/schema compatibility matrix

| Combination | Status | Conditions |
| --- | --- | --- |
| v1.33 + 0061 | Conditionally safe | Current state, but exposed to known trigger and lock risks |
| v1.33 + 0062 | Conditionally safe emergency compatibility | Lifecycle features disabled; no new lifecycle actions; merged-source operations monitored |
| Stabilization app + 0061 | Unsafe for promotion | Readiness must fail and deployment must not receive production traffic |
| Stabilization app + 0062 | Safe target state | Readiness passes and stabilization behavior is active |
| Future Edit app + 0062 | Safe only after Edit's own gates | Merge/archive remain disabled |
| Rollback to v1.33 with 0062 retained | Conditionally safe emergency compatibility | Lifecycle features disabled and stabilization restored promptly |

The old application is not described as fully lifecycle-aware.

## 8. Feature PR designs

### Edit Client

- Patch only first name, last name, phone, email, and birthday with
  `expectedUpdatedAt`.
- Use established server normalization.
- Detect same-salon active, archived, and alias conflicts.
- Keep cross-salon matches non-disclosing.
- Preserve old current contacts as private aliases.
- Preserve appointment, receipt, payment, and communication snapshots.
- Fail closed for unsupported external identity effects.
- Resolve canonical identity before the one-active-appointment check.
- Keep future communication using the current contact.
- Add a focused dialog to the existing More menu.

### Archive and Restore

- Owner/admin only.
- Archive the terminal client and suppress proactive outreach in the same
  transaction.
- Every outreach writer locks and revalidates the client before creating or
  reactivating state.
- Preserve appointments and history.
- Continue transactional reminders for existing valid appointments, while
  proactive marketing remains suppressed.
- Restore only after locking and rechecking active, archived, and alias
  conflicts.
- Never restore a merged source as a separate client.

### Merge redesign

The first release uses fail-closed loyalty strategy Option B. A merge is
blocked when either profile has:

- Nonzero loyalty balance.
- Rewards.
- Referral history.
- Manual reward adjustments.
- Unresolved reward conflicts.
- Unsupported external identity linkage.

The merge must:

- Preserve the primary stable ID.
- Lock all clients in deterministic order.
- Relink stable references without copying financial records.
- Preserve immutable snapshots.
- Flatten valid incoming merge chains and reject cycles.
- Apply the strongest safety/blocking state.
- Recalculate cached totals from canonical records.
- Use an idempotency/audit record.
- Make repeated requests return the recorded result.

Historical reward resolution must search canonical current and historical
identities, prevent duplicate issuance, and enforce one-way redemption even
though reward-bearing profiles remain merge-blocked.

### Deferred permanent deletion

No ordinary permanent-delete UI or route is delivered in the initial
lifecycle sequence. It remains deferred until all phone-keyed identity and
dependency writers can participate in one transactional barrier. Privacy
erasure is a separate audited workflow.

## 9. PR #55 salvage matrix

| Area | Classification | Treatment |
| --- | --- | --- |
| Edit UI | Reusable after modification | Extract focused form concepts only |
| Edit validation | Reusable after modification | Narrow fields and fail closed for identity links |
| Duplicate detection | Reusable after modification | Include archived clients and aliases |
| Merge preview | Reusable after modification | Keep presentation concepts, replace contract |
| Merge transaction | Must be redesigned | Do not reuse max-balance or current locking |
| Contact aliases | Reusable after modification | Retain private lookup semantics |
| Note history | Safe to reuse nearly unchanged | Preserve author and timestamps |
| Destination snapshots | Safe to reuse nearly unchanged | Preserve historical recipient |
| Database triggers | Must be redesigned | 0062 replaces function bodies |
| Lifecycle permissions | Safe to reuse nearly unchanged | Owner/admin for destructive lifecycle actions |
| Archive/restore UI | Reusable after modification | Extract without merge/delete coupling |
| Archive transaction | Must be redesigned | Add transactional outreach barrier |
| Permanent delete | Deferred/removed | Do not extract |
| Client Insights | Reusable after modification | Add alias parity and terminal filtering |
| Reward changes | Must be redesigned | Canonical identities and fail-closed merge |
| Review changes | Reusable after modification | Terminal resolution and client-first locks |
| Appointment canonicalization | Reusable after modification | Resolve before active restriction |
| CI changes | Reusable after modification | Keep disposable PostgreSQL, add missing paths |
| Tests | Reusable after modification | Replace timing sleeps with deterministic barriers |

Never cherry-pick PR #55's broad feature commits wholesale. Extract reviewed
path-level patches only. Keep unrelated calendar work out of this sequence.

## 10. Test matrix

All database concurrency tests use disposable PostgreSQL and deterministic
barriers or advisory locks, not arbitrary sleeps.

| Finding | Deterministic coverage |
| --- | --- |
| H1 | Populated migration with retention paused at lock boundaries |
| H2 | Remove each required object and assert readiness failure/503 |
| H3 | Child, review, campaign, appointment, and lifecycle interleavings |
| H4 | Merge blocked for nonzero/manual loyalty value |
| H5 | Alias reward lookup plus simultaneous issuance/redemption |
| H6 | Concurrent current-contact and alias bookings yield one active appointment |
| H7 | Archive commits while outreach is paused; no later outreach state |
| H8 | No ordinary delete action/route; deletion project remains gated |
| M1 | Every proven v1.33 writer succeeds through terminal resolution |
| M2 | Directory and Insights alias-search parity |
| M3 | Client Hub response shape with lifecycle-inactive rows counted once |
| M4 | Manual/automatic reminder parity for archived future appointments |
| M5 | Required upgrade, compatibility, concurrency, browser, and coverage jobs |

PR 0 additionally requires:

- Fresh full chain through 0060, exact 0061, and 0062.
- Populated 0060 to exact 0061 to 0062.
- Exact journaled 0061 applying only 0062.
- Production-shaped 0061 applying 0062.
- A fully migrated rerun as a no-op.
- Failure before readiness publication followed by a clean retry.
- Current v1.33 against exact 0061 and 0062.
- Stabilization app against 0062.
- Emergency v1.33 rollback against retained 0062.
- Every attached lifecycle trigger.
- Same-salon acceptance and cross-salon rejection.
- Three-client chain, missing target, excessive depth, and cycle rejection.
- Retry success and exhaustion for `40P01` and `40001`.
- Idempotent writer behavior.
- Client Insights count/list parity.
- Legacy Client Hub response compatibility.
- Canonical completed outstanding with no duplicated financial rows.
- Proof that Edit, Merge, Archive, Restore, and Delete actions are absent.

CI credential changes are limited to what migration, compatibility, and
concurrency testing requires. Broad unrelated secret/workflow cleanup is
deferred.

## 11. Rollout plan

### Preflight

1. Confirm exact 0061 SQL hash, journal metadata, and expected objects.
2. Run count-only lifecycle data validation.
3. Validate the existing merged-source chain without PII.
4. Run production-shaped 0061 to 0062 rehearsal.
5. Record migration and readiness timings.
6. Stop for any checksum, journal, cycle, target, tenant, reference, or
   compatibility mismatch.

### Existing release path

Repository inspection must precede workflow edits. The existing path consists
of CI on `main`, semantic-release after successful CI, and an external Vercel
Git integration. PR 0 must not create a competing production deployment
pipeline.

The migration-first release runbook is:

1. Keep PR 0 unmerged.
2. Approve one immutable PR head after CI, Preview, rehearsal, and review.
3. Run count-only Production preflight from that immutable commit.
4. Apply 0062.
5. Run private readiness verification.
6. Verify current v1.33 remains operational under emergency compatibility
   limits.
7. Only then merge the approved commit so the existing Vercel integration can
   deploy `main`.
8. Verify the additive health response and deployed SHA.
9. Keep all lifecycle flags disabled.

If this ordering cannot be guaranteed operationally, stop release and add
enforcement through the existing deployment provider/settings rather than
creating a second pipeline.

### Monitoring and smoke test

Monitor `40P01`, `40001`, `55000`, lock timeout, transaction retries, lifecycle
readiness, retention, communication, review, reward, booking, Client Insights,
Client Hub, and completed-outstanding signals.

Production smoke testing is read-only unless a separately approved synthetic
fixture exists. It must not modify a real client, message, appointment, reward,
or identity.

### Cleanup and stop conditions

Delete temporary database branches, credentials, files, and sessions. Retain
aggregate evidence only.

Stop for any migration mismatch, invalid merge chain, readiness failure,
compatibility failure, unexpected lock duration, deadlock increase, financial
discrepancy, Insights count mismatch, or authentication ambiguity.

## 12. Rollback plan

- **Migration failure:** Transaction rolls back; do not deploy; retry only
  approved transient SQLSTATEs.
- **Application failure:** Retain 0062 and redeploy v1.33 as conditional
  emergency compatibility with lifecycle flags disabled.
- **Deadlock increase:** Stop affected work, keep feature flags disabled, use
  the previous application, inspect lock graphs, and correct forward.
- **Trigger regression:** Pause affected writer and use the next forward
  migration; never edit 0061 or 0062.
- **Reward issue:** Disable affected reward/merge paths, preserve rows, and
  reconcile from immutable evidence.
- **Client Insights issue:** Disable lifecycle mutations, rollback the
  application query change, and compare canonical count/list results.
- **Authentication issue:** Disable lifecycle actions, rollback application,
  and do not mutate external identities.

Rollback never removes the migration journal, merged source, aliases, rewards,
audit history, or capability metadata.

## 13. Exit criteria

### Stabilization PR may merge only when

- The plan-only commit is first.
- Exact 0061 adoption is a separate verified commit.
- 0061 matches Production byte-for-byte and remains immutable.
- 0062 is forward-only, atomic, and reviewed.
- Fresh, populated, already-0061, no-op, failure/retry, current-app, and
  rollback compatibility cases pass.
- Existing merged-source validation is clean.
- Old-writer and trigger-table tests pass.
- Exact concurrency tests pass without timing sleeps.
- Readiness blocks partial schema.
- Health remains backward-compatible and additive.
- Migration timing and lock behavior are accepted.
- Full CI, Vercel Preview, and independent database/security review have no
  Critical, High, or Medium blocker.

### Edit may begin only when

Stabilization has operated in Production for at least 24 hours without
lifecycle readiness, lock, writer, Client Insights, financial, or identity
regression.

### Archive/Restore may begin only when

Edit has been stable for at least 48 hours and its alias, booking, identity, and
snapshot behavior is verified.

### Merge redesign may begin only when

Archive/Restore has completed at least seven days including reminder and
retention cycles, canonical metrics remain stable, Option B blockers are
approved, and reward/external identity handling is fail closed.

### PR #55 may be closed only when

- Stabilization is production-verified.
- Every useful PR #55 path is mapped to a successor or explicitly rejected.
- No required audit, test, or evidence exists only in PR #55.
- Its closing note states that it was never merged or deployed and is
  superseded by the recovery sequence.
