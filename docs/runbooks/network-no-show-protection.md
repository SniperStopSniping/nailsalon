# Network no-show protection

## Delivery and activation are separate

This implementation is dark by default. It does not enroll salons, backfill
appointments, enable deposits, generate a key, or modify real customers.
`NETWORK_NO_SHOW_ENABLED` must be exactly `true` AND a salon must have an active
`network_no_show_participation` row. The owner cannot change participation.
The dedicated `NETWORK_NO_SHOW_HMAC_KEY` must contain at least 32 characters.
Keep it server-only. Rotating it requires an explicit binding migration; never
silently generate a replacement at startup.

Apply migration `0087_network_no_show_protection` through the repository's guarded
database workflow before activation. Production still requires its documented
backup/confirmation controls. Do not apply this migration by sending SQL through
an application API. No historical source appointments are eligible: registration
happens only in a new public/customer booking transaction, after participation's
prospective timestamp, with an appointment created before its scheduled start.
Owner/staff-created bookings remain outside automatic collection/publication.

## Product contract

Participating salons automatically see a compact Booking Risk card when an
eligible contact pair has active history. There is no owner warning-off switch.
The sole owner control, under Payments > Deposits > No-show protection, is:

- Warn only (default)
- Require deposit at 1+ recorded no-show
- Require deposit at 2+ recorded no-shows

Ordinary enabled deposits continue to apply to everyone as before. Protection
adds applicability only and uses the same configured fixed CAD amount, discount
cap, minimum charge, entitlement, readiness, checkout, waiver and refund paths.
No-show protection does not waive ordinary deposits. Owner/staff booking and
rescheduling collection behavior remains unchanged.

Only an exact normalized phone AND email pair is eligible. No name matching,
phone-only/email-only matching, aliases, fuzzy matching, ML, OTP or legacy
customer sessions. Shared/conflicting pairs can be suppressed by an operator.
An exact pair is not proof of possession or unique personhood. Undetected shared
pairs remain a product limitation. Neither a local profile edit nor a duplicate
client merge transfers network history. Source contact edits suppress existing
binding attribution.

Count only explicit recorded `no_show` events within 12 calendar months of the
appointment end. Leap-day anniversary clamps to February 28. Reporting is after
appointment end and within seven days. Cancellation/refund/completed visits do
not add events. One appointment has one source event. Status corrections revoke
it transactionally, even with rollout disabled; stale repeats cannot revive it.

## Boundaries

The shared service returns only inactive/unavailable or count + 12-month window.
No source salon, appointment dates, services, money, messages, notes, reasons or
client profiles are serialized to receiving salons. Public booking receives only
deposit terms, never network count. A contact-dependent deposit change stops
before booking creation and requires another explicit confirmation click.

The boundary is server-only application code using the existing database
connection, not a claim of separate database-role/RLS isolation. Ordinary tenant
queries remain tenant-qualified. The owner profile requires an eligible local
booking binding and matching current contacts, rather than a manually created
contact record alone. Profile queries have database-backed tenant/actor budgets
and read audits. Existing public booking rate limits protect quote/commit paths.

Immutable binding/decision snapshots, event provenance, source-revocation audit,
and restricted operator audit remain internal. Source mutation transactions set
transaction-local actor context while the platform gate is active; direct SQL or
writers without actor context are recorded as system actions. Do not interpret
system attribution as an identified human correction.

## Restricted operations

`POST /api/super-admin/network-no-show` requires the existing super-admin guard.
Requests are strict, rate limited and no-store. There is no contact-search or
bulk-import action. `mode` defaults to `plan`; `apply` must be explicit. Plan reads
produce audit evidence but do not change participation, bindings or events.

Request shape:

```json
{"action":"inspect","salonId":"synthetic-salon","appointmentId":"synthetic-appointment","mode":"plan"}
```

Actions:

- `inspect`: minimal internal state, scoped by salon and optional appointment.
- `enroll_salon`: platform gate/key required. Uses server time for the prospective
  boundary; cannot backdate. Repeating an active enrollment preserves its epoch.
- `disable_salon`: stops participation, revokes source events and suppresses
  bindings; reenrollment cannot revive the old source history.
- `suppress_event`: accuracy dispute, using the tenant-qualified source appointment.
- `suppress_subject`: conflicting/shared/recycled identity; suppresses the pair.
- `erase_subject`: removes bindings/events and retains a non-serving HMAC tombstone
  to prevent replay. Tombstone retention needs privacy review before pilot.
- `cleanup_salon`: explicit tenant-scoped retention cleanup. Removes events more
  than 30 days beyond expiry; removes old bindings only once their appointments
  are older than 13 months and have no events; removes non-event tenant
  read/operation audits after 90 days. Event audit follows event deletion.
  Orphaned subject HMACs, suppressed/erased tombstones and restricted global
  operator records are not silently deleted by this action; their retention
  policy and a subject-first cleanup pass are required before activation.

No cleanup schedule or external automation is installed. Establish and verify an
operational cleanup cadence, tombstone/audit retention policy, customer access
and dispute process, participation terms and customer disclosure before enabling
a real cohort. These are activation requirements, not OTP infrastructure.

A dispute may suppress sharing immediately while existing deposit forfeiture or
refund reconciliation proceeds independently. Never erase financial records to
correct network risk. Review already-open deposits using the existing waiver /
refund controls; do not automatically rewrite settled payments.

## Validation and staged rollout

Use synthetic salons and contacts only. Never mark a real customer no-show for a
smoke test. Validate exact-pair collisions, 1 -> 2 -> corrected 1 -> expired 0,
dark-mode correction, wrong-tenant reads, no public source leakage, duplicate
status delivery, suppression/erasure concurrency, deposit review and idempotency.

Ship dark; validate isolated Isla/synthetic fixtures; enroll an explicitly
approved warning-only cohort; then enable optional owner-selected enforcement;
expand beta only after correction, privacy and payment evidence is reviewed.
Turning off the platform gate stops exposure/publication/enforcement. Existing
holds, payments, refunds and unconditional source-revocation triggers remain in
force. No deployment alone activates the network.
