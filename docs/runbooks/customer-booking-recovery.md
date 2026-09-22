# Public booking recovery

Service selection never mounts a global booking-status card. Confirmation owns progress and recovery. Do not delete an unresolved operation capability or interpret an expired review/cache receipt as proof that no appointment exists.

## Durable normal-confirmation handoffs

The normal booking coordinator retains the existing operation capability and flow ID. Before confirmation, it persists a `confirming` marker. After a lost response or refresh it performs bounded, read-only status reconciliation. A linked appointment returns the normal confirmation/approval presentation. Payment-required and other non-success states remain contextual to confirmation.

If reconciliation remains unresolved, confirmation shows a recovery error. A deliberate retry reuses the same durable operation through the canonical prepare/confirm path. It does not create a fresh operation. The existing database operation lock/link remains the exactly-once authority.

Legacy salon-wide operation records are adopted at confirmation through the capability-authenticated `/api/public/customer-booking/[salonId]/handoff` bridge. The bridge reissues a normal flow for exactly the stored operation's session ID; it neither calls AI nor creates an appointment. Client evidence is removed only after both replacement storage entries are verified. Conflicting/damaged evidence fails closed.

## Direct manual bookings

Before sending the original POST, the browser saves the attempt ID, a random recovery proof and confirmation URL in session storage. Successful existing Redis idempotency receipts include only the SHA-256 proof hash and expire after the configured 15-minute TTL. New v2 attempts also retain a client `startedAt` and are registered in the tenant-scoped `public_booking_attempt` table before validation.

The same-origin, no-store `/api/public/booking-attempt/[salonId]/status` route checks the proof-bound v2 durable record before the tenant-scoped cached receipt. It never calls creation or a provider. The appointment link and durable `succeeded` transition commit together. An unclaimed v2 attempt is fenced only after ten minutes by a proof-bound `failed` tombstone, so a late POST cannot create. A legacy v1 receipt miss, expiration, Redis failure or wrong proof means unresolved, not failed.

The browser automatically polls status, not creation. An unresolved direct attempt blocks another submission and offers Check again and the existing secure Find booking flow. Explicitly recognized definitive validation rejections permit a deliberate correction/retry. Ambiguous deposit checkout errors retain the pending identity.

The older direct endpoint's Redis idempotency is fail-open and writes receipts after commit. Therefore this change does not claim that every direct booking has durable exactly-once server identity. It prevents the recovery UI from introducing an unsafe replay. A commit whose receipt cannot be recovered still requires secure booking lookup/salon assistance; do not solve that case by clearing storage and booking again.

Recovered receipts describe the original creation result. Durable recovery returns a minimal historical appointment projection; `awaiting_payment` remains a payment hold and does not reopen a checkout URL. Their booked service/tax/duration snapshots drive presentation, not the current menu. Missing historical facts are not fabricated. Current appointment/payment details remain available through the private management link. Expired or malformed recovered checkout links are not reopened automatically.

## Diagnosis

A historical global banner was caused by `BookServicePageServer` mounting `CustomerBookingRecovery` whenever a legacy local-storage operation existed. That component displayed `not_created` even for a prepared operation that had never been submitted, checked only once, and continued rendering resolved records. Removing the mount preserves the capability while moving recovery into confirmation.

When investigating a specific browser, inspect only presence/version/state metadata for the salon's recovery keys. Never copy capabilities, recovery proofs, management URLs or customer details into logs/issues. A clean profile does not establish what another browser contains.

## Regression evidence

- Client helper and confirmation tests: initial visit, persistence failure, malformed state, bounded read recovery, definitive rejection, explicit durable retry and legacy adoption.
- `tests/browser/customerAssistant/recovery.spec.ts`: Chromium/WebKit, 320px, double confirmation, lost response, refresh, resolved revisit and unresolved checks.
- Existing operation/creation PostgreSQL concurrency suites remain authoritative for durable replay/tenant/concurrency guarantees.
- Existing backend browser journeys exercise both standard and L1 Customer AI → normal booking handoffs without live models, messages or payments.

Migration `0090_misty_sprite` is required; no salon setting change is required.
