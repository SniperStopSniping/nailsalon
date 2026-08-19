# ADR 0007 — Production Schema Readiness

**Status:** Accepted.

## Context
A real incident: application code was deployed expecting migrations through `0072`
while the production database was still at `0068`. The public salon route returned
**HTTP 500** while **`/api/health` reported `status: "ok"`**. A later deploy
reproduced the same class of failure.

The root cause is structural: **deploying code does not migrate the database**, and
nothing in the system made that gap observable. Health checked dependencies, not
whether the schema the code expects actually exists.

## Decision
**Health must not report readiness when the release expects a newer migration tail
than the database has applied.**

- **Expected tail** derives from `migrations/meta/_journal.json`, imported as a
  module — repository-owned, updated automatically whenever a migration is added, and
  requiring no runtime filesystem access in a bundled server runtime.
- **Applied tail** comes from one bounded, **read-only** query against
  `drizzle.__drizzle_migrations`. The ledger stores hashes rather than tags, so
  **counts** are the comparison signal.
- Five states are distinguished: `match` · `behind` · `ahead` · `malformed_ledger` ·
  `query_failed`. **Only `match` is ready.**
- **`ahead` is not ready.** A database carrying migrations the code does not know
  about is not a safe state to call healthy.

Health **never mutates**. This check does not migrate the database, and migration
remains an explicit, guarded, separate action.

Publicly the endpoint exposes only a bounded `'ready' | 'not_ready' | 'unavailable'`
string, matching the existing `clientLifecycleSchema` / `depositsSchema` siblings.
Migration names and counts stay internal.

## Consequences
The endpoint's existing HTTP contract is preserved — degraded already returns **503**,
and schema drift now participates in that, scoped to production-hosted environments so
preview and local may legitimately run ahead of an un-migrated database.

**Known operational consequence:** the safe deploy order (migrate first, then deploy)
produces a transient `ahead` window in which readiness reports not-ready. That is the
intended reading of "the database has something this code does not know about", but it
means migrate-then-deploy will briefly show degraded. Deliberate; recorded here so it
is not mistaken for a defect.
