# Find-booking and direct-attempt recovery

## Diagnosis

Production request logs inspected on 2026-09-22 contain two `POST /api/appointments` 409 entries on deployment `dpl_ZnwqQg1ejvXdpSh7T7LujKKu77Ek`, with no response body or application error code. These logs cannot identify the exact rejected condition in the reported reproduction. A 200 status lookup and a 202 find-booking response are not evidence of an appointment.

On the original main implementation, direct confirmation writes a salon-scoped v1 pending attempt to sessionStorage before POST. Only selected rejection codes clear it. Definitive codes such as `CONTACT_IDENTITY_CONFLICT`, `BOOKING_IDENTITY_CONFLICT`, and `BOOKING_FINANCIAL_QUOTE_CHANGED` fall through to uncertain recovery. Reschedule conflicts also have uncovered codes. `BOOKING_IN_PROGRESS` and `IDEMPOTENCY_KEY_REUSE` must remain protected because they do not establish failure of the original request.

The v1 browser record has no timestamp or expiry. It survives refresh/navigation in the tab, including browser session restoration when the browser preserves sessionStorage. Server recovery only reads the successful Redis receipt; its actual TTL is 900 seconds (15 minutes). Receipt writes happen after appointment commit and the old Redis idempotency path can fail open. Therefore a missing receipt never proved failure and could leave the tab locked indefinitely.

Find-booking accepted email and/or normalized phone, resolved canonical lineage and active appointments, and then always called the email sender. Phone-only lookup still depended on the authorized stored email. The confirmation review subtitle rendered independently of the recovery notice, producing contradictory statements.

## Authority after this change

New direct creation attempts use protocol v2, retaining the random attempt UUID and independent recovery proof. PostgreSQL stores the proof hash, canonical request hash, lifecycle state and tenant-bound appointment link. Registration precedes creation, under distributed rate admission. The appointment transaction locks that same attempt and links the appointment atomically. Redis is no longer the v2 replay authority.

- `resolved_success`: the exact attempt is linked to its appointment; recovery projects current status from that tenant-bound database row. Holds and inactive appointments are not called confirmed.
- `resolved_failure`: a rejected request or stale attempt has been closed under the database lock while unlinked. The browser clears only the matching capability and permits a deliberate new confirmation.
- `pending` / `unknown`: creation may still be in progress or authority is unavailable. The browser performs bounded status checks and never automatically repeats creation.
- A stale unlinked attempt can be fenced after ten minutes using the database registration time. A v2 request that never registered can receive a failed tombstone. A late original request must acquire the same lock and cannot insert after that fence. Time alone never clears browser storage.

Legacy v1 attempts are not promoted to v2. Without a receipt or durable attempt identity, a lookup by contact/time cannot prove that one exact submission did not commit. These cases retain duplicate protection and offer secure find-booking and salon assistance. A second browser has no first-browser capability; it uses secure email/phone recovery, not an identity-based attempt-status query.

## Contact recovery

Email-only requests use the authorized stored email. Phone-only requests queue a recovery text to the authorized stored phone, independently of whether email is usable. Both inputs resolving to one canonical identity use email; conflicting/ambiguous identities cause no delivery. The form explains this and labels the selected delivery method.

SMS recovery uses the existing communications dispatcher, canonical/snapshot identity checks, suppression and consent gates, sender readiness, rate/credit controls, opaque short management links, and token lifecycle. A stored phone with blocked SMS remains a neutral contact-salon path; recovery never overrides STOP or redirects delivery to an arbitrary submitted destination. Queued recovery must revalidate appointment activity and recipient authority before provider delivery.

Every lookup outcome returns the neutral accepted response (with the existing infrastructure-unavailable error contract retained). No appointment details or existence are returned to the requester. Token access remains bearer-based and tenant-scoped.

## UI

Pending recovery stays visible during checks, hides both 'Not booked yet' variants, disables confirmation, and offers Check again, Find my booking and salon contact. Authoritative failure restores review without automatically submitting. Recovered payment holds and terminal statuses have distinct presentation. Recovery actions stack at small widths so 320px/200% text remains usable.

## Validation and delivery

Synthetic-only validation includes local PostgreSQL multi-connection creation/fencing/rollback tests, isolated PGlite recovery and communications tests, client component tests, mobile Chromium/WebKit browser fixtures, and appointment regressions. No real customer appointment, recovery email/SMS, or payment is created by these tests. Provider functions are mocked; browser fixtures intercept backend writes.

Migration `0090_misty_sprite` adds only the durable attempt table and constraints. Apply using the guarded Production migration command after a verified backup, before the corresponding production application release. CI, independent review, release SHAs and final production verification are recorded in the delivery report.

Rollback must retain the v2 creation registration/linking guard. A pre-v2 application ignores the protocol header and could commit without durable authority; do not roll back to that handler while v2 clients or requests exist. Roll forward with a scoped fix, or retain the v2-compatible creation path in any rollback build. Keep the additive table.
