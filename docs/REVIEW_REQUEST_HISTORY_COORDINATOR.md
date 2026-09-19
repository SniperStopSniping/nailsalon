# Review request history coordinator

This source preparation retains the existing lifetime indexes and settings
writer. It does not activate finite repeats. Before retiring those indexes,
deploy every review allocator and relevant Google-review history writer with
the shared salon review fence, then separately approve the guarded migration.

The coordinator matches durable requests within the salon by client lineage,
normalized recipient, or appointment identity. It reserves the client while
an intent is pending, claimed, blocked for credit, sending, uncertain, failed,
or missing. Only proven never-sent canceled, suppressed, or expired intents
release the reservation. Contradictory provider evidence fails closed.

For accepted sends, cooldown starts at the existing intent `resolvedAt` recorded
when it became `sent`. Delivery receipts and later delivery failures do not move
that timestamp. Missing timestamps do not acquire a synthetic current time.
An unreleased request for the same appointment always blocks another request.
An explicitly configured 90-, 180-, or 365-day cooldown permits a later visit at
the exact boundary; a null/legacy policy continues to mean never repeat.

Legacy owner-marked Google-review history counts even if its status later becomes
converted or dismissed. A claimed send with a missing timestamp fails closed.
Legacy history matches recorded lineage and appointment identity. Old entries
do not reliably store a recipient snapshot, so historical recipient coverage
cannot be reconstructed or guaranteed. No backfill guesses a phone identity.

Manual acceleration is restricted to the same appointment, current lineage and
recipient, and an existing pending intent. Dispatch rechecks current history,
excluding only its own reservation. Consent, suppression, provider behavior,
reminders, payment behavior and both AI architectures are unchanged.

Validation includes pure boundary/uncertainty decisions, PGlite allocation and
reader identity cases, and the existing dispatcher suite. The future repeat
allocation case drops lifetime indexes only inside an isolated PGlite test
transaction that deliberately rolls back. It does not apply a migration or
weaken deployed constraints.
