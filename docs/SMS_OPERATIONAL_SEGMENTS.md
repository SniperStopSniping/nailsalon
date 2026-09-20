# Operational SMS presentation (2026-09-20)

## Product decision and scope

Owner approved removing automatically appended STOP instructions from appointment confirmations, reminders, reschedule/cancellation updates, booking-request status updates, and Google review requests. This is a presentation change, not consent or opt-out removal. The salon identity prefix remains. Generic manual SMS keeps its footer. Promotional campaigns, win-back/Next Visit discounts, native phone drafts, provider configuration and billing reconciliation are unchanged.

The Google review action remains an explicitly owner-selected category with editable copy and the existing server-side review coordinator. It does not semantically classify copy or detect promotions. Ordinary manual text is never promoted to review/operational text by substring matching.

## Rendering and compatibility

- `prepareSmsBody` calculates encoding, units, segments and predicted credits only after all text and URLs are assembled. The same final string is snapshotted and submitted to the provider.
- Review requests use `client_review_request/v2`; legacy proven-unsent review intents using `client_manual_text` resolve to it by their trusted event type. Generic manual intents do not change.
- Operational template revisions are v2. Pending proven-unsent operational messages intentionally adopt the current copy. Actual renderer key/version are saved at the existing locked sending transition; accepted/unknown messages and historical snapshots are not rewritten or resent.
- New/restored review default: `Thanks for visiting! We'd love your Google review: {{reviewLink}}`. Exact stored copies of the old shipped default resolve to the new default on read, without a database update or backfill. Any customized template remains unchanged. Saving settings subsequently persists the displayed value.
- No migration, automation activation, consent modification, sender change, or new redirect is required.

## Quantified fixtures

Fixtures: Isla Nail Studio; `Wed, Sep 23, 12:30 PM`; 46-character `https://lustergel.app/a/{22-character token}`; supplied 39-character Google review URL. All are GSM-7. The short origin is a test fixture, not a production configuration assertion.

| Message | Old units/segments | New units/segments |
| --- | --- | --- |
| Confirmation | 143 / 1 | 120 / 1 |
| Reminder | 142 / 1 | 119 / 1 |
| Reschedule | 136 / 1 | 113 / 1 |
| Cancellation | 132 / 1 | 109 / 1 |
| Supplied review custom copy | 177 / 2 | 154 / 1 |
| New review default | 177 / 2 | 119 / 1 |

Each segment reserves one credit. A 24-septet salon name makes the new review default 127 units; confirmation with the maximum 56-character short-link fixture is 138 units. Custom Unicode and long links remain intact and may use additional segments. No one-credit guarantee is made for arbitrary customized text.

## Preserved safeguards and known limits

Consent checks, signed inbound STOP/START processing, shared suppression, independent provider revocation, 21610 handling, 30007 delivery-only classification, final pre-send rechecks, retries, deduplication, unknown-outcome holds and refund/history accounting remain unchanged. Default-on appointment reminders do not authorize reviews. Preview does not reserve credits, mint capability links or send.

Current charges use the GSM-7/UCS-2 calculator. Production `setTwilioCostFetcher` wiring remains a separate gap; this change does not claim verified provider-segment reconciliation. The calculator targets the existing long-code profile (160/153 and 70/67); US/Canada toll-free multipart limits and provider-side Smart Encoding need separate verification before a sender change. Existing salon-name sanitization/truncation remains visible in the final preview and is not a universal international identity solution.

## Recorded compliance/provider risk

This implements an intentional owner decision; it is not a compliance clearance. Twilio requires an initial opt-out instruction and its carrier guidance describes recurring reminders. Canadian commercial electronic messages can require identification/contact information and an unsubscribe mechanism even where transaction-related consent exceptions apply. Review requests are not automatically exempt surveys. Keeping STOP processing does not substitute for any required visible notice. No replacement enrollment SMS, new consent flow, or automatic periodic notice is introduced here.

Official references checked during the plan:
- https://www.twilio.com/en-us/legal/messaging-policy
- https://help.twilio.com/articles/1260803966670
- https://laws-lois.justice.gc.ca/eng/acts/E-1.6/page-1.html
- https://crtc.gc.ca/eng/com500/faq500.htm
- https://www.twilio.com/docs/glossary/what-sms-character-limit

## Verification and release

Run focused renderer, dispatcher, review, consent, transport, ledger/callback and UI suites, typecheck, lint, appointment regression and full Vitest. The review-request Playwright journey covers final-body previews in the mobile project using isolated fixtures. No real provider messages are required for these tests. Any live SMS test requires a separately approved recipient.

Release from protected main only after required CI/review/Preview gates pass. Do not introduce a review URL shortener or change provider-account settings in this delivery. Rollback restores prior code for unsent messages; historical snapshots and accepted/unknown sends retain their existing handling.
