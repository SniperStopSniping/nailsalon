# No-show reporting and customer review

## Reporting rules

- Open the action exactly 24 elapsed hours before the appointment's canonical start instant. Use the configured salon timezone to display that instant. Subtracting 24 hours rather than a local calendar day preserves the rule across daylight-saving transitions.
- Before start, accept only **Customer cancelled with insufficient notice** or **Customer confirmed they would not attend when contacted by the salon**. Both require an explicit owner choice; a future absence alone is not evidence.
- At and after start, also accept **Customer did not attend** and **Other**. Other requires an explanation. Private notes are optional and bounded.
- Pending, confirmed and in-progress appointments retain their existing state eligibility. Completed, cancelled, deleted and deposit-hold appointments cannot be newly reported through this action.
- There is no reporting deadline after a visit. Local no-show status can be recorded for an eligible older appointment; events outside the existing 12-calendar-month window do not re-enter shared history.
- Ordinary cancellation is separate. The owner cancellation dialog has no No-Show reason shortcut.

## Atomic publication and corrections

The source status, immutable reason/note audit, network event, deposit forfeiture bookkeeping and calendar outbox changes commit together through the existing transaction. A failure rolls them back. The publication acknowledgement says either **shared** or **saved locally but not shared**.

No network tables or public identity lookup were added. Prospective public-booking bindings, normalized exact phone **and** email matching, HMAC identities, subject/platform locks, source uniqueness, platform controls, suppression and expiry remain authoritative. Owner-created/manual/walk-in bookings remain local.

The prestart publisher requires recorded confirmation evidence. Legacy future marks without that evidence are not newly published before start. Existing past records remain compatible. Reconciliation retains bounded batches and cannot replay a corrected, disputed, suppressed, erased or expired contribution.

Owners correct mistakes in **More → No-show records**; platform reviewers retain the existing **Correct to cancelled** action. A reason and current source version are required. The source-change trigger revokes the event in the correction transaction, and existing uniqueness/tombstone fences prevent resurrection. Payment/refund history is preserved.

## Customer requests and platform review

1. The customer uses their existing private booking-management link and selects **Request review of this no-show**. An expired or unavailable link requires verified platform support or the salon to issue a fresh capability through the existing authorized manage-link flow; Find my booking currently targets active appointments and is not a guaranteed recovery path for no-shows. Public review intake requires a valid capability for the reported appointment; no retired customer account or OTP system is revived.
2. The endpoint accepts only an explanation, never a salon, appointment, event or contact-search target supplied by the customer. The capability's exact salon/appointment binding, expiry and revocation are rechecked under transaction locks. IP and hashed-capability rate limits apply.
3. A request creates one immutable appointment audit entry. An active event is immediately suppressed with `customer_review`; a request without an event leaves a durable audit fence that also stops later reconciliation.
4. The response is generic: no network count, matched identity, event identifier or other salon's information. Reasons/notes never enter receiving-salon risk responses.
5. Platform staff open **Super-admin → No-show records → Customer review requests**. They can inspect the customer's explanation, correct a mistaken source mark, keep the contribution removed, or explicitly uphold a verified report with a reason.
6. Upholding cannot override source correction/deletion, another moderation suppression, invalidated bindings, suppressed/erased subjects, expired history, or platform pause. Retries cannot restore a closed request. There is one customer intake request per appointment; reopening a closed review requires a platform support review, not repeated public submissions.

The UI's recorded-history warning is a limited count and 12-month window, not a probability or blacklist. Warning-only, deposit at one, and deposit at two still use the existing payment readiness, currency, entitlement and policy conditions.

## Earlier deposit decisions: required manual review

A correction or dispute changes subsequent risk reads immediately. A transaction that already committed a booking decision keeps its immutable decision snapshot. No automatic payment, refund, forfeiture reversal, invoice mutation or client message is introduced by a review.

For each correction/dispute, platform reviewers use the restricted source binding's subject ID to identify other bindings with `decisionSnapshot.riskRequired = true`. Re-evaluate their salon policy against the current active count, then review the appointment's existing deposit/payment state in that salon's authorized Payments workflow:

- **Unpaid hold:** review whether the deposit is still required by the salon's ordinary policy or other active reports. Arrange the normal release/rebooking process if it was required only by the withdrawn history; do not silently cancel or alter the customer's booking.
- **Paid/forfeited deposit:** review the original decision, service status and refund evidence. An authorized salon manager handles any adjustment/refund through the existing payment controls after explicit review.
- **Completed/refunded/cancelled booking:** preserve the financial ledger and original decision snapshot. Record the review outcome in the existing appointment audit.

Receiving salons receive only their own booking/payment review context and the refreshed count. Do not disclose which salon/report prompted a review. This release provides the review instructions and existing payment tools; automated fan-out deposit-review tasks and automatic refunds are deliberately not introduced.

## Verification and release

Tests use synthetic data, in-memory PGlite, a disposable loopback PostgreSQL database, mocked communications/payments and browser fixtures that reject external requests. The acceptance scenario is 3pm Toronto / explicit confirmed nonattendance at 2:30pm / immediate receiving count 1.

Run the targeted no-show, appointment route/hook/dialog, correction, risk/deposit and capability tests, the PostgreSQL serialization suite, type checking, changed-file lint and mobile/desktop browser fixtures. Production/provider activity is not part of these tests. No database migration is required.

Deploy through the protected main branch only after current CI, Preview checks and review conversations pass. No database migration is required for this release.
