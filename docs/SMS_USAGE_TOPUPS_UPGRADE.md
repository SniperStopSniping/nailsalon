# More: SMS usage and top-ups

## Scope

The More header and existing settings groups stay in their original order. A Text Message Balance card sits above Booking. Today shows a compact direct top-up action at ten or fewer available credits. Both use the existing salon-authorized communications usage API and append-only credit ledger.

No salon data migration, new subscription, monthly reset, credit expiration, automatic charge, free-credit claim rule, or messaging-provider replacement is introduced.

## Screens and navigation

- More → **Buy More Texts** → existing Plan & Usage route, `view=topup` → choose one package → existing Stripe Checkout.
- More → **View usage history** → existing Plan & Usage route, `view=history` → chronological credits and purchase grants.
- Today → low-credit warning → `view=topup` directly.
- Existing Plan & Usage → Messages & credits retains starter-credit claims, billing portal, purchase status history and masked message-delivery history.
- Settings → Notifications → **Low text balance emails** controls owner balance warnings, using the existing salon notification email recipient.

## Balance truth

`readSmsCreditOverview` reads balance, pending credits, purchases and current-month settled usage in one repeatable-read snapshot. The month follows the salon time zone. Refunded segments are excluded from usage. Reserved credits are excluded from available credits but are identified separately.

A denominator is shown only for a provable single active allocation. Mixed lots, refunds and historical expiry show the remaining number with a qualitative balance-status strip, without inventing a percentage. Negative dispute availability displays zero spendable texts.

History contains dates, categories and credit deltas, never message bodies or recipients. Historical running balances are omitted because the existing ledger does not persist the reservation/virtual-expiry snapshot needed to reproduce them accurately.

The client discards failed or stale-salon responses, refreshes when messages/credits change and on focus, and periodically refreshes a visible balance. Server authorization remains mandatory. Checkout actions remain owner-only.

## Packages and payment

The shared versioned catalogue adds:

| Key | Credits | One-time CAD price |
| --- | ---: | ---: |
| `topup_100_2026_10` | 100 | $20 |
| `topup_200_2026_10` | 200 | $30 |
| `topup_500_2026_10` | 500 | $50 |

The 500-credit offer is Best Value. The previous successful credit quantity is recognized even when its historical offer key differs. The owner still explicitly initiates every checkout.

Retired August offers remain immutable and resolvable for old purchases and webhook evidence; they cannot start new checkout sessions. Server validation checks the offer, owner, salon, price ID, currency, price amount and one-time Stripe price type. Client amounts are never accepted.

The existing paid-webhook fulfillment, append-only grant, per-salon locks, refund/dispute handling and unique grant key remain authoritative. The return URL now carries the exact purchase and salon. A success redirect only says confirmation is pending; the dashboard confirms the specific fulfilled purchase before announcing credits added and requesting a fresh balance. Older fulfilled purchases cannot satisfy this check.

## Warning delivery

`SMS_CREDIT_THRESHOLDS` centralizes 25 and 10. Existing stored tier `20pct` is retained as a compatibility name for the fixed 25-credit threshold, avoiding a schema migration.

Warning detection, the warning marker and insertion into the existing integration outbox share one account-locked transaction. Unique salon/epoch/tier keys prevent duplicate jobs. A qualifying grant re-arms only thresholds that the balance recovered above. Small grants within the same band and SMS refunds cannot repeatedly re-arm warnings.

The outbox checks current preferences, recipient, warning epoch and balance before sending. It uses the existing Resend sender with a stable payload and provider idempotency key. Failed sends retry; stale warnings cancel. Automatic retry stops before Resend's 24-hour idempotency window expires. Exhausted warnings remain failed for operator review and do not send another failure email.

Provider reference: [Resend idempotency keys](https://resend.com/changelog/idempotency-keys).

## Deployment and activation requirements

1. Merge only after required CI, preview and review gates pass. Deploy committed protected `main`, then verify the production Git SHA and health.
2. Map the three new **one-time CAD** Stripe prices in `BILLING_STRIPE_PRICE_IDS` for each intended environment. Preserve existing historical mappings; do not overwrite the carrier with only the three new entries.
3. Keep test and live price/account/webhook evidence separate. Verify the existing `stripe-billing` webhook signature secret, account identity, event subscriptions and reconciliation cron through the repository billing readiness procedure.
4. Do not enable `BILLING_TOPUPS_ENABLED` merely because the UI or local tests pass. First complete controlled test-mode payment acceptance: paid → one grant, retry → no duplicate, failed/cancelled → no grant, return → exact purchase and refreshed balance.
5. Low-balance emails use the existing communications sweep and integration-outbox cron. Verify an authorized owner test mailbox through configured Resend before claiming provider-delivered acceptance.
6. No database migration is required. Existing salon credits and verified-identity starter claims are preserved.

At the start of this task, production health reported billing dark. This change does not flip that switch or create Stripe prices. When purchasing is unavailable, packages remain visible with disabled purchase actions and an accurate availability message.

## Verification evidence

Local evidence lives outside the source checkout at:
`/Users/me/Documents/Codex/2026-10-08/sms-usage-upgrade/`.

- `relevant-regression.log`: 850 tests across 28 files passed before final small refinements; final delta tests are recorded separately.
- `postgres-concurrency-final.log`: all 12 real PostgreSQL concurrency tests executed, zero skips. An earlier checkout lock-observation wait timed out once; the unchanged assertion passed on the diagnostic and final runs.
- `mobile-browser-round2.log`: 27 desktop/mobile Chromium and WebKit checks passed at 1440, 390 and 320 CSS pixels.
- `build.log`: production build completed; final source build/checks are recorded separately.
- `lint-final.log`: zero errors; four pre-existing Fast Refresh export warnings in AppGrid/SettingsModal.
- More, top-up and history PNGs are actual browser captures of production components with isolated synthetic data. They are not evidence of a real Stripe charge, authenticated live-salon access, email delivery or physical-device testing.

The browser fixture blocks external network requests. Its simulated payment-return test proves UI refresh only. Verified-payment and duplicate-webhook behavior is independently covered by server/database tests using provider fixtures.
