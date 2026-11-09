# Closed SDK checkout reservation checkpoint

This slice connects the installed Stripe SDK's serialization and response
validation to a durable operation journal through a closed, in-memory HTTP
transport. It remains unregistered and test-only. It never calls Stripe, exposes
a customer checkout URL, settles money or enables production collection.

## Authorization and durable ownership

Reservation authenticates the private appointment bearer before collision/replay
inspection, then repeats authorization under the appointment/source locks. It
reconstructs the request from the saved quote instead of accepting caller money,
account binding, customer details or return URLs. Persisted reconstruction data
contains neither the bearer nor private URLs.

Migration 0127 adds source-scoped revision history and immutable reservation
material. The final authorization compares the saved source revisions and full
financial-context digest. Relevant source changes invalidate the original
authority even if the source is later restored. Already-revoked, unrelated
Stripe-account history does not change the active account set.

Dispatch intent and one-use consumption commit before the SDK transport can
consume the request. A private, process-local brand proves a permit came from a
confirmed repository commit. Unknown commit outcomes, retries, restarts, lease
expiry and unsupported production markers cannot grant another create.
Recovery reads only an already bound Session. Its result continues to carry
`providerOriginVerified: false` and `financialPostingAllowed: false`.

## Unresolved appointment protection

Every SDK journal operation retains an unresolved financial reservation. The
application guards and SQL triggers block financial/lifecycle mutations,
ordinary tenders, deposits and reparented child rows while it exists. Administrative
notes/contact-display edits remain possible. Security revocation and owner
disable remain possible and invalidate execution authority.

Neither Session status, lease expiry, a feature flag nor a declined response
clears this reservation. There is no production reservation-release, settlement
or refund workflow in this slice.

## Retry regression corrected during takeover

The unfinished repository incorrectly treated any change of charge ID as an
ownership conflict. A declined charge on an unpaid Session may legitimately be
followed by a different successful charge on the same PaymentIntent. The existing
SDK response contract already permits that evolution.

The durable SDK path now freezes a charge ID only after capture evidence has
been validated. Integration tests close and reopen the persistent store between
observations, accept a declined-to-captured transition, and still reject replacing
an already captured charge. Both observed charge identities remain in the
ownership history. The successful diagnostic observation still cannot post money.

## Evidence and remaining work

See `customer-payments-integration-gates.md` for the final validation results and
`customer-payments-base-compatibility.md` for source provenance and release gates.
All SDK HTTP responses in these tests are scripted. Real Stripe sandbox execution,
verified provider receipts, settlement, refunds, late-payment recovery and actual
customer checkout remain unimplemented or unverified here.
