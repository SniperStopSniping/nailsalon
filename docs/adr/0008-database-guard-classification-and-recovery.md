# ADR 0008 — Database Guard: Classification and Warm-Runtime Recovery

**Status:** Accepted.

## Context — the incident

Production Neon (the real, revenue-serving database — see "Environments" below)
exceeded its compute quota. PostgreSQL returned `53000`
("exceeded the compute time quota"), driven by ~110.4/100 CU-hrs consumed against
the Launch plan's monthly allotment. Every server route 500'd for roughly seven
hours.

Two separate defects turned a provider outage into a multi-hour, wrongly-diagnosed
incident.

### Defect 1 — misclassification

`src/libs/runtimeDatabaseGuard.ts`'s `verifyRuntimeDatabaseConnection` wrapped live
attestation in a bare `catch` that collapsed *any* failure into
`DATABASE_ATTESTATION_REJECTED` ("live environment attestation failed"). The actual
chain during the incident:

```
Neon quota exceeded
  -> MARKER_QUERY fails (Postgres 53000)
  -> rejectNonProductionMarkerForProduction throws PRODUCTION_MARKER_QUERY_FAILED
  -> bare catch discards that code
  -> DATABASE_ATTESTATION_REJECTED
```

`nonProductionDatabaseGuard.ts` already distinguished "the marker query could not
execute" (`PRODUCTION_MARKER_QUERY_FAILED` / `MARKER_QUERY_FAILED`) from "the marker
query executed and proved the wrong database" (`PRODUCTION_MARKER_NONPRODUCTION`,
`PRODUCTION_MARKER_INVALID`, `MARKER_ENVIRONMENT_MISMATCH`, etc.) — the bare catch
threw that distinction away. **A provider outage was reported as a wrong-database /
security failure**, which sent on-call diagnosis in the wrong direction for hours:
attention went to "did someone repoint `DATABASE_URL`" instead of "is Neon down."

### Defect 2 — poisoned warm runtime

After Neon's quota reset and a manual `SELECT 1` succeeded in 461ms, **production
kept 500ing on every route**. Only redeploying the same, unchanged source (forcing
new cold Vercel function instances) recovered it.

`src/libs/DB.ts` builds its Postgres pool and forces one attestation probe inside a
module-level top-level `await`, then **throws** on failure. A module whose top-level
evaluation throws is permanently poisoned for the life of that module registry — the
ECMAScript spec fixes a Cyclic Module Record's evaluation outcome the first time it
settles, and no later `import` re-runs the body. Concretely, in `DB.ts` prior to this
fix:

- On probe failure, the pool was disposed and the module threw *before* assigning
  `globalForDb.pgPool` / `pgDrizzle`.
- Every subsequent `import { db } from '@/libs/DB'` in that same warm instance
  replayed the same failure — forever, regardless of whether the database had since
  recovered — because nothing in the file ever re-ran that initialization logic.
- A redeploy is the only thing that creates a fresh module registry (fresh
  processes), which is exactly why redeploying unchanged code "fixed" it.

## Decision

### Classification: two distinct meanings, never conflated

- **Security/integrity → `DATABASE_ATTESTATION_REJECTED`, fail closed.** The marker
  query executed and the result proves the wrong database, or proves identity can
  never be established from it: explicit non-Production marker, marker contradicting
  Production, missing/duplicate marker row, invalid marker value, missing marker
  table on a Non-Production target. Also fail-closed: a query that DID reach a real
  server and got back a real, *recognized* Postgres error that isn't a
  connection/timeout/quota code — e.g. `42501` (insufficient_privilege) or `42703`
  (undefined_column). Those prove the database is reachable, just wrong or
  misconfigured (a stale `DATABASE_URL`), which must never be reported as merely
  "unavailable" — that would tell an operator to wait for a recovery that will
  never come.
- **Provider/availability → new `DATABASE_UNAVAILABLE` code.** The marker query
  could not execute at all, and the underlying failure is a recognized
  connection/timeout/quota-class code (Postgres class `53`/`08`, `57P03`, `57014`;
  or `ECONNREFUSED`/`ETIMEDOUT`/etc.) or carries no code at all (never reached
  Postgres's protocol layer). No identity claim was ever made, so this can never be
  reported as a security mismatch, and never as ready.

Implemented as a narrow allowlist (`classifyAttestationFailure` in
`runtimeDatabaseGuard.ts`) checked against the underlying error's own code, which
`nonProductionDatabaseGuard.ts` now preserves as `NonProductionDatabaseGuardError`'s
`cause` for its two "query could not execute" codes — no new exception hierarchy.
Ambiguous or unrecognized codes fail closed as attestation-rejected, never
availability. No error or log carries the underlying message, connection string, or
credentials in either classification.

A related asymmetry, found by adversarial review of this change and fixed with it:
when the marker query **resolves** but returns a shape the guard cannot read, the
database is demonstrably reachable, so this is an identity failure. Production already
treated it that way (`PRODUCTION_MARKER_INVALID`), but the Development/Preview path
reused `MARKER_QUERY_FAILED` — an availability code — so the *same* reachable-but-wrong
database reported "temporarily unavailable" in one environment and "attestation failed"
in the other. Development/Preview now rejects with a distinct `MARKER_RESULT_INVALID`,
and both environments are pinned to `DATABASE_ATTESTATION_REJECTED` by the same test.
Not reachable through `pg` today (a real driver either resolves `{rows: [...]}` or
throws), but it is precisely the misdiagnosis harm this ADR exists to remove.

### Recovery: bounded, concurrency-safe, never bypassing attestation, no proxy

An early draft of this fix made `db` a lazy stand-in (a `Proxy`) while the initial
connection was down, retrying on each access. Adversarial review caught a blocker
before merge: Drizzle's chainable builders (`db.select().from().where()`) are not
Promises — `.select()` returns a builder synchronously, and only the awaited final
link executes the query. A `Proxy` `apply` trap that defers via `ensure().then(...)`
hands back a `Promise`, not a builder, so `.select(...).from` is `undefined` —
breaking essentially every one of this codebase's ~200 chained call sites, healthy
or not. That approach was dropped entirely; `db` is now bound to a genuine Drizzle
handle unconditionally, once, and never re-bound.

The actual fix needed no proxy. `pg-pool` already re-runs the per-client `verify`
hook (`createRuntimeDatabasePoolVerifier`) on **every new physical connection**, not
once at pool construction — a live, undestroyed `Pool` already self-heals: the next
query that needs a fresh connection re-attempts it, and `verify` re-attests it, with
no other code involved. The entire poisoning bug was `DB.ts` choosing to
`pool.end()` + `throw` on the *first* bootstrap failure. So the fix is:

- `src/libs/DB.ts` constructs the `Pool` synchronously (`new Pool()` never touches
  the network) and publishes `db` unconditionally — module evaluation can no longer
  fail on a provider outage.
- The eager warm-up probe (`pool.query('SELECT 1')` at module load) is now
  best-effort: its outcome is swallowed, never thrown, and never disposes the pool.
- `src/libs/runtimeDatabasePoolRecovery.ts` wraps the per-connection `verify` hook
  with a bounded cooldown (5s): a failed target is retried only after the cooldown
  elapses, which is what prevents a per-connection storm during a sustained outage.
  The cooldown only governs *when* `verify` may run a fresh round-trip — the real
  verifier underneath still runs on every attempt that clears it, so a genuinely
  wrong database keeps failing every single one, forever.
- The cooldown is deliberately **not** single-flighted. A draft collapsed concurrent
  callers into one shared in-flight attempt; review rejected it, because each caller
  is pg-pool verifying a *distinct* new physical connection, so sharing admits every
  other connection in the burst on a different connection's attestation — accepting
  connections never themselves attested. Per-connection attestation must hold for
  concurrent connections too. The burst is bounded regardless: pg-pool opens at most
  `max` connections at once (2 on Vercel), and the first recorded failure
  short-circuits everything after it for the whole cooldown window.
- `withDedicatedDatabaseSession` needed no change at all — `globalForDb.pgPool` is
  now always set once a runtime target is resolved, so it reverts to exactly its
  pre-incident form; `pool.connect()` goes through the same cooldown-gated verifier.

### Recovery sequence (for the next occurrence)

1. Restore Neon compute capacity (wait out the quota reset, or raise the plan).
2. Verify database identity and migration tail (`/api/health`: `db`, `schemaDrift`).
3. Recycle the runtime only if warm instances are still poisoned on old code (not
   needed once this fix is deployed — recovery is now automatic, on the very next
   connection pg-pool opens once the cooldown elapses).
4. Verify representative routes (public salon page, booking, `/api/health`).

### No data loss

Confirmed: 89 tables, 4 salons, 144 appointments, 74 migrations, all intact. This was
a compute-quota outage, not a storage or data event.

## Environments (for on-call reference)

Production and Preview are **separate Neon projects in separate orgs**: Production
lives in a personal org, Preview under the Vercel-managed workspace. Both are on the
Launch plan. Production and local development share the Production project, which is
why local usage draws down the same compute budget.

Exact org/project/branch/endpoint identifiers are deliberately **not recorded here** —
this repository is public. Read them from the Neon console or the deployment's
configured environment when responding to an incident.

## Consequences / follow-ups (recorded only — not implemented here)

- `public.luster_environment` does not exist in Production. The guard's design
  treats an absent marker table as valid for Production (no marker required) — this
  incident did not change that, but it is a deliberate decision that deserves its own
  review. **No migration is created by this change.**
- Neon project/org ownership consolidation (Production sits under a personal org,
  Preview under the Vercel-managed workspace) is deferred.
- `luster-preview` is provisioned on the Launch plan; it likely only needs Free.
  Owner billing decision, not made here.
- **No `statement_timeout`/`query_timeout` is configured on the pool** (pre-existing,
  unchanged by this ADR). `connectionTimeoutMillis` bounds the *connect* phase, so a
  refused or unreachable provider is bounded — but a backend that accepts a connection
  and then stalls is not. That leaves the module-load warm-up probe, and any ordinary
  query, unbounded in the stalled-backend case. Worth fixing; deliberately out of
  scope for an incident hotfix.
- Checkly's ~10-minute production probes prevent Neon's autosuspend, so Production
  compute is effectively always-on — roughly $19–20/mo of compute by itself,
  independent of this incident's quota spike. Worth revisiting as a cost decision.
- Whether `/` (or any other route) should remain globally DB-attested on every
  request, versus a cheaper/staler check, is unresolved.
- Broader dev/preview/prod topology separation is unresolved.

## Enforced by

`runtimeDatabaseGuard.test.ts` (H1 classification matrix — quota/connection-refused/
generic-provider-failure vs. wrong-database/malformed-marker/`42501`/`42703`, plus
no-credential-leak), `runtimeDatabasePoolRecovery.test.ts` (cooldown, per-caller
attestation under concurrency, storm bound from a recorded failure,
wrong-DB-stays-rejected), `DB.recovery.test.ts` (end-to-end against the real `DB.ts`
wiring with a mocked `pg.Pool` — including a chained-builder regression test,
`db.select().from().where()`, pinning the Proxy blocker described above so it cannot
recur), `src/app/api/health/route.test.ts`.
