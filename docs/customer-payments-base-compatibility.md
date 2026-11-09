# Payment takeover and homepage compatibility

The user authorized continuing the unfinished payment work in a separate
worktree while preserving Dot's original branch. Production activation and
deployment remain outside this checkpoint.

## Source provenance

- Latest fetched `origin/main` at takeover was
  `7da552ad5e5a1e52688300fda09777c83fa084f5`, including homepage PRs 498 and 499.
- The new branch is `codex/luster-payments-takeover-20261108`.
- The original payment branch remains at
  `4a180dea4a54d7f98b21115759c5123ea3173622` with its unfinished files preserved.
- Its 15 committed payment checkpoints were cherry-picked onto the new main
  base without conflicts. A content-hashed snapshot of its 44 unfinished files
  was then copied into the new worktree. Source hashes were checked before and
  after copying. All subsequent fixes belong only to the takeover worktree.

The homepage source, package and lockfile come from the new main base. No
dependency change, schema regeneration or existing migration rewrite was needed
to carry the payment work forward. The closed-checkout model is now exported
through `src/models/Schema.ts`, which is an existing Drizzle schema entry point.

## Remaining release gates

The protected-surface checks in `.github/workflows/CI.yml` still require explicit
review before this complete payment branch can pass release CI:

1. SQL-path and migration-journal tag allowlists stop at
   `0114_daniela_automation`. Payment migrations 0115 through 0127 need a reviewed,
   narrow admission. No gate was removed or relaxed in this checkpoint.
2. The inherited `src/libs/salonPurge.ts` change rewrites existing lines to add
   payment-safe locking and history retention. The additive-only check rejects
   it before the approved-postimage check. Adding a hash alone is insufficient.

Update in `codex/luster-payments-live-20261109`: the purge extension now preserves
every existing line in both `origin/main` and the V133 reviewed head. A payment-
specific error subclass keeps the existing error contract, and PostgreSQL's
default ascending order preserves the parent lock order without rewriting imports.
The exact postimage still needs review and admission; the CI allowlist is unchanged.

## Application migration remains separate

Migration 0117 changes existing appointment, tender, service, add-on and deposit
locking. Migration 0127 adds source-revision triggers and unresolved SDK
reservation guards. These protections apply independently of payment UI flags,
and the new application guards require the corresponding schema to be present.
A code-only deployment cannot assume disabled flags eliminate migration needs.

Before an application migration, preflight reserved `cpay_` identifiers and
`customer_payment_capture:` references, orphan history, schema readiness, parent
lock ordering and retry behavior. Disposable database verification does not
authorize or attest an application-database migration.

Actual provider execution, verified ingress and settlement, refund/recovery
workflows, authenticated customer journeys, commercial policy, release CI and
deployment approval are still separate gates. See
`customer-payments-integration-gates.md` for the latest scoped test evidence.
