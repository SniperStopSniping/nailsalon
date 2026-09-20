# Next Visit Offer

## Product contract

The offer rewards the **date of the next appointment**, not the date a booking is submitted. A salon can turn it on under Marketing & Messages → Offers → Next Visit Offer. New and existing salons default to OFF, 30 days and 5%. There is no backfill or automatic activation.

A qualifying visit is explicitly completed, has a final invoice with positive value and at least one positive catalog service line, and is not complimentary or deleted. Payment collection is separate: a completed unpaid visit can qualify. `completedAt` is the anchor, including when a historical visit is completed later. The deadline is the salon-local calendar date plus the chosen window, inclusive through that day's end. Calendar-day arithmetic handles DST.

An issued offer snapshots its window, services, discount, currency and timezone. Editing settings changes future issuance. Turning OFF stops issuance but honors unexpired issued offers. Each qualifying visit can grant one independently usable offer; generic client rebooking selects the newest currently available one. Older promises are not silently revoked.

## Owner controls

- Enabled/disabled.
- Window: 14, 21, 28, 30 or 42 days; custom 1–90 days.
- Percentage or fixed amount, capped by the eligible service subtotal.
- All base services or selected active services.
- Optional customer message, shown alongside authoritative terms.
- Issued, reserved and used status counts.

Add-ons and custom checkout items are excluded from the offer basis. Guest customers do not need an account. The owner rebook action reuses the existing appointment modal; its catalog amount is explicitly labeled **Before offers**, and the booking server determines the applied amount. Public booking uses the existing server quote and normal Time → Details → Confirm flow.

## Pricing and precedence

Only one promotional discount applies to an appointment. Next Visit is compared with the existing automatic result (rewards, first visit or Smart Fit); the larger amount wins, and a tie preserves the existing result. An existing explicit win-back campaign retains its current behavior. An offer that loses this comparison is not reserved.

The offer is stored in existing appointment discount fields; catalog service prices are unchanged. Existing tax, deposit, final invoice, payment and refund calculations remain authoritative. Offer events retain issuance/reservation/repricing/release/consumption evidence. A checkout manual discount replaces the offer rather than stacking; when the current offer calculation differs, a deliberately different reason is required. The prefilled offer label is not override intent.

## Lifecycle

Booking reserves the entitlement in the same transaction as the appointment. Pending requests and payment holds reserve too. Cancellation, decline and definitive hold expiration release the same offer with its original deadline. Completion and no-show consume it. Replaying booking or completion cannot create another redemption.

Moving outside the window or to ineligible services removes the discount. The allocation remains attached to that visit, so moving back inside can restore it. Managed price changes require explicit acceptance of the new service total. Active deposit/payment balances or unresolved financial evidence must be reconciled before a price-changing managed edit; settled zero-credit deposit history does not permanently block editing. No payment ledger is rewritten by this feature.

A cancelled discounted appointment cannot simply be reactivated with its old price; use the normal rebook flow to check current terms and availability. An invalidated qualifying source revokes an unreserved offer. An already reserved/consumed dependent offer prevents silently invalidating its source.

## Messaging and AI

This release creates no automatic promotional messages or new consent mechanism. Review Requests remain independent. Opening a receipt or owner screen does not send a message or mint a new entitlement. Opaque rebooking links are created on an explicit rebook action, and all links for one source share the same entitlement.

Customer AI receives fresh server-authored public offer terms or capability-bound offer facts. It does not calculate eligibility or discounts, receive customer identities, or create a booking engine. Private offer references are signed into salon-bound conversational context; raw campaign tokens stay out of model input. The normal booking handoff preserves campaign context and revalidates contact, service, date and price. These authoritative read facts can be reused by a future phone receptionist; this release adds no voice system.

## Database and release

Migration `0086_next_visit_offer.sql` adds nullable settings, immutable offers, events, campaign references and a lifecycle trigger. Existing settings and appointments are not backfilled. Prior migrations must remain byte-for-byte unchanged.

Before Production mutation: reconcile the established database continuity evidence, inspect the ledger, verify the reviewed migration checksum, create and verify a fresh Neon recovery point, and use the existing guarded migration procedure. Apply only the reviewed migration, then verify constraints, trigger and ledger. Deploy only the reviewed protected-main release through normal gates. Do not enable Isla or another salon as part of deployment.

Synthetic verification includes actual PostgreSQL migration/concurrency and canonical booking operations, PGlite completion/managed-edit/settings/purge tests, Customer AI contracts, and Chromium/WebKit component journeys. No real customer messages, payments or appointments are needed for verification.
