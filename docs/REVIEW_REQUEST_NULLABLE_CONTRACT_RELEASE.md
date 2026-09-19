# Review request nullable contract release note

The compatible null-safe reader may deploy before migration 0082. Migration
0082 must be applied before any writer produces a null
`review_request.completed_at`. It is additive apart from dropping the column's
not-null constraint: existing review history is neither backfilled nor changed.

The migration fails before creating the appointment-active index when existing
non-cancelled rows duplicate a salon and appointment. Resolve that data
explicitly before retrying; do not delete or rewrite review history as part of
the migration.

The old client and recipient lifetime uniqueness indexes remain in force. A
record without `completed_at` must carry a durable `trigger_id`; unlinked null
records remain invalid. The check and trigger foreign key establish only an
anchor, not that the trigger belongs to the same salon or appointment. Current
send readers therefore fail closed for every null completion. Deploy the schema
migration before enabling any future scheduled-end producer that creates
trigger-backed requests, together with its tenant- and appointment-scoped
sender validation.
