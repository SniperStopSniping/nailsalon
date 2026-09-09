# Client reminders

Owners open **More → Client reminders** (or `/admin?app=client-reminders`).

- **Usage & history** shows available SMS credits, any credits temporarily set aside for sending, and per-message net credit charges. Email, reminders cancelled before sending and fully refunded texts do not use SMS credits. Long texts can cost multiple credits. A message row is not a credit.
- History groups confirmations, 24-hour reminders, 1-hour reminders, cancellations and other messages. The filter applies to loaded history; **Load more** retrieves older entries. Historical reminders without a saved lead time keep the generic label, because current settings cannot prove their original timing.
- **Settings** reuses the existing salon communications endpoint. Owners can choose up to three reminder times, channels, quiet hours, event settings and pause. Existing preferences remain in place until saved. Quiet hours and recipient consent still apply; setting a reminder does not guarantee delivery.
- Reminder timing is saved with each new intent, so changing salon settings later does not relabel older messages. Net charges use settled reservation lots and their partial/full refunds, scoped to the authorized salon.

## Text packs and activation

The existing CAD catalog remains authoritative:

| Credits | Free plan | Paid plan |
| --- | --- | --- |
| 100 | $6.99 | $5.99 |
| 250 | $15.99 | $13.99 |
| 500 | $29.99 | $26.99 |
| 1,000 | Not offered | $49.99 |

This change does not activate production purchases or create Stripe resources. Complete the billing production runbook before enabling sales:

1. Create/verify active, one-time, fixed CAD Prices for the applicable immutable offer keys in the intended Stripe account. Keep existing mappings for issued offers; pending payments use those mappings for verification.
2. Set server-only `BILLING_TOPUP_PRICE_IDS` outside Git, with this shape: `{"dev":{},"test":{},"prod":{}}`. Each environment object maps canonical top-up offer keys to that environment's verified Stripe Price IDs. Never place live IDs or credentials in committed files. Malformed, duplicate and unknown mappings fail closed. Runtime `BILLING_PLAN_ENV` selects the environment.
3. Configure the dedicated `/api/webhooks/stripe-billing` endpoint and `STRIPE_BILLING_WEBHOOK_SECRET`. Presence of a secret is necessary but does not prove that Stripe is delivering events. Verify signed completion, expiration, refund and dispute handling using Stripe test mode first.
4. Verify card-only Checkout, exact price/currency/amount and tenant metadata validation, exactly-once credit granting, duplicate checkout requests, interrupted checkout recovery and refund/dispute ordering. Run the required CI and browser checks. No real customer charge is part of automated testing.
5. Only after configuration and verification, enable `BILLING_TOPUPS_ENABLED` in the intended environment. The usage API exposes only configured offers for the owner's plan. Missing billing flag, price mapping or dedicated webhook secret keeps purchases unavailable.

Checkout sends buyers to Stripe. Credit grants come only from verified payment evidence, never from visiting the success URL. An uncertain checkout creation remains blocked until its bounded expiry; it must not be blindly repeated with a new purchase.

Relevant checks: `lowBalanceWarnings.test.ts`, `communicationMaterialization.test.ts`, `UsageBillingModal.test.tsx`, top-up checkout and Stripe billing webhook tests, `stripePriceMap.test.ts`, appointment regression, and the Client reminders test in `mobile-admin-appointment-sheet.e2e.ts`.
