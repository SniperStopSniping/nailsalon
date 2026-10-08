# Calendar read contention (Q05 / S58)

Date: October 8, 2026. Base: origin/main 8c121457.

## Evidence

Production previously logged `GOOGLE_CALENDAR_CONNECTION_WRITE_FENCE_LOST` during outbox reconciliation. This was a protective rejection, not evidence of expired credentials or a general Calendar outage.

The isolated regression runs the actual cron route, actual outbox and inbound workers, actual Calendar adapter, SQL migrations and connection revision checks. Only credentials/transport, heartbeat and alert delivery are controlled. Holding both successful token responses on the same stored revision reproduces the reconciliation failure seen in the logs: the second response loses the write fence after the first commits. One baseline case failed and the disconnect control passed. This establishes a reproducible code path; it does not attribute every production log entry to that path.

## Correction

Calendar-list and event-list context acquisition may retry **once** after a connection-revision fence loss. The losing token response is discarded. The retry reloads the current tenant row and revalidates its status and credentials before making its own fully fenced update.

- A second collision fails closed.
- A disconnected or deleted connection remains inaccessible. A deleted tenant connection cannot fall back to the global integration on retry.
- Stale outbox attempts, dispatch-fenced calls and appointment mutations keep their original fail-closed behavior.
- Invalid grants are not reclassified as transient contention.
- Parent cancellation and the original event-list aggregate deadline apply to both attempts.
- Existing logs, publication/tenant safeguards and provider request ceilings remain.

No reconnection, provider credential change, schema migration, UI redesign, customer communication or real Calendar request is part of this patch.

## Verification

The focused local selection passes 159 tests in 10 suites. The new 12-case suite covers both worker orderings over three collisions each, credential rotation, bounded repeated contention, deletion, disconnect, invalid grant, parent cancellation, cancellation during retry, original aggregate timeout, stale job ownership and unchanged appointment-write fencing. PGlite supplies the local database; provider responses are synthetic and all Calendar transports are asserted to be GETs. This is not live Google acceptance.

The same suite has an explicit PostgreSQL mode using the existing strict disposable-target validator and live session attestation. It resets only that opted-in disposable test database, so the real workers see an empty queue. One step is added to the existing hosted D5 PostgreSQL job and requires all 12 cases with zero skips. Parsed workflow comparison confirms all earlier jobs, commands and gates are unchanged; 15 existing workflow/source/commit guard tests pass.

Local port 55432 belongs to a pre-existing test server. That server was not reset or stopped; PostgreSQL-mode proof is pending the isolated hosted CI run. No PostgreSQL or live-provider success is claimed from PGlite results.

## Release and remaining acceptance

The local production build, explicit typecheck and scoped lint passed. Hosted CI, exact Preview and production status remain separate. Required PostgreSQL CI must pass before merge. A controlled real Google round trip and concurrent production observations remain B03. The bounded retry cannot guarantee completion under unlimited contention; subsequent collisions remain visible and later eligible scans can retry through the existing worker path.
