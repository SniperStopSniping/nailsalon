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
  `drizzle.__drizzle_migrations`, widened to select both `count(*)` and
  `max(created_at)`. The ledger stores hashes rather than tags, so **counts** are the
  primary comparison signal — but counts alone are not sufficient. Drizzle's migrator
  writes each journal entry's own `when` value into `created_at`
  (`node_modules/drizzle-orm/migrator.cjs`: `folderMillis: journalEntry.when`), so
  whenever the counts agree, the applied tail's timestamp is additionally compared
  against the expected tail's `when`.

  This closes a gap that is live in this repository, not theoretical: the L-track
  runs provisional, renumbered migrations across parallel branches, and dev and
  production share one Neon database. Branch B's `0074` can get applied to that
  shared database; branch A then deploys expecting *its own* `0074`. Counts agree
  (both sides see the same length), so a count-only comparison reports `match` —
  `ready` — against a schema the running code was never built for. The timestamp
  check catches exactly that.
- Six states are distinguished: `match` · `behind` · `ahead` · `tail_mismatch` ·
  `malformed_ledger` · `query_failed`. **Only `match` is ready.**
- `tail_mismatch` — equal counts, divergent applied-tail timestamp — is the false-match
  case above. Not ready, and it pages (see Consequences).
- **`ahead` is not ready, semantically.** A database carrying migrations the code does
  not recognize is not a verified-safe state. But see Consequences: unlike the other
  four non-ready states, `ahead` deliberately does not page.

Health **never mutates**. This check does not migrate the database, and migration
remains an explicit, guarded, separate action.

Publicly the endpoint exposes a bounded `'ready' | 'not_ready' | 'ahead' |
'unavailable'` string, matching the spirit of the existing `clientLifecycleSchema` /
`depositsSchema` siblings (bounded, no raw tags/counts/timestamps — those stay
internal to `schemaReadinessCore`). `ahead` is broken out from the generic
`not_ready` bucket specifically so it stays visible and diagnosable in the response
body without being indistinguishable from the states that page.

## Consequences
The endpoint's existing HTTP contract is preserved — degraded still returns **503**.
`behind`, `tail_mismatch`, `malformed_ledger`, and `unavailable` all gate
`criticalChecksPass` in production — that is the actual incident class this ADR
exists to catch, and all four still page.

**`ahead` deliberately does NOT gate `criticalChecksPass`, and does not page.** This
repository's safe deploy order is migrate-first, then deploy — manually, and the gap
between the two can run to hours. Because dev and production share one Neon database,
a developer applying a migration locally puts production into a count-ahead reading
with no deploy in flight at all. Checkly probes production every 10 minutes
(`checkly.config.ts`, `Frequency.EVERY_10M`) asserting `response.status() === 200`
and `health.status === 'ok'` (`tests/e2e/Sanity.check.e2e.ts`), with failure emails
on. Gating on `ahead` would therefore alarm for the entire manual
migrate-then-deploy window on every migration-bearing release, and for any ad hoc
local migration against the shared database with no release involved at all.

`ahead` is still not ready in the sense that matters — a database carrying
migrations the code does not recognize is not verified safe, and it is reported that
way (`schemaDrift: 'ahead'`, not `'ready'`). It is nonetheless not a paging
condition here: the operational cost of paging on it is alert fatigue. The on-call
owner learns that "degraded" usually just means "the process is working", which is
exactly how the next real `behind` incident — the one this ADR exists to catch —
gets ignored. That would defeat the point of this entire check.

So `ahead` stays visible and diagnosable in the response body, distinct from
`not_ready`, but only `behind`, `tail_mismatch`, `malformed_ledger`, and
`unavailable` can flip `status` to `degraded` and the HTTP code to 503.
