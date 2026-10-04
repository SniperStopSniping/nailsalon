# Free access and SMS top-ups

The current commercial policy includes all normal Luster features. SMS retains per-salon segment counting internally, expressed as texts and text credits to owners. There are no new app subscription sales.

## Data and payment boundaries

- `sms_credit_account`, credit lots, reservations, purchase records, and immutable historical catalogs remain the source of financial evidence.
- The starter allowance is 50 non-expiring credits per verified business identity. Historical 100-credit claims stay claimed and retain their balance. Verified email and phone links survive salon deletion and key rotation.
- New catalog keys are `topup_100_2026_10` (CAD 2000 cents), `topup_200_2026_10` (3000), and `topup_500_2026_10` (5000). Historical offers remain resolvable for paid fulfillment and refunds, but cannot start new checkout.
- Purchased lots never expire. Existing monthly and promotional expirations remain intact. Provider disputes retain debt evidence internally; the owner-facing spendable balance is clamped at zero.
- Actual salon sends use intents and the dispatcher. Explicit phone/copy drafts are unmetered. Platform super-admin authentication invitations have no salon and remain outside salon billing.
- Provider acceptance settles a reservation. Definite rejection releases it; terminal failure reconciliation refunds it. Unknown outcomes retain the hold without an automatic resend.
- Checkout returns identify the salon and purchase and open the existing `plan-usage` destination. Returns never grant credits. Only paid provider evidence can fulfill a purchase, under existing purchase/session idempotency.

## Production rollout

1. Verify the preview and required CI on the committed branch. Subscription sales remain disabled by the central policy even if the old switch is enabled.
2. Run the existing starter identity readiness inventory. Reconcile historical claims and protected email/phone evidence before setting `BILLING_STARTER_IDENTITY_READY=true`. Unresolved identities must receive no automatic grant.
3. As a super-admin, GET `/api/super-admin/billing/free-model-transition` to inventory active salons. POST `{salonSlug, mode:"plan"}` for each salon and retain the reports. Plans are read-only and report identity conflicts and readiness holds.
4. Provision and verify only the three current packages using `scripts/provision-sms-topups.ts`. Supply a mode-matched `STRIPE_TOPUP_PROVISIONING_KEY`; run with `NODE_OPTIONS=--conditions=react-server`, `--env test|prod`, and first `--plan`, then `--apply --carrier-out <private path>`. If a carrier already exists, pass `--carrier-in` to preserve historical mappings. The output is private, and no activation occurs in the script.
5. Configure the verified environment carrier and a distinct billing webhook signing secret using existing Vercel mappings. Verify endpoint scope, pinned API version, handled event types, cron authorization, provider mode, tax settings, and integrity using the existing billing readiness tools. Keep tax behavior as configured; no new automatic tax choice is made here.
6. After review of each rehearsal, POST `{salonSlug, mode:"apply", confirmation:salonSlug}`. This ensures the credit account, preserves lots/usage/holds, and grants only an eligible unclaimed starter allowance. Retry is safe. It also schedules cancellation of renewals on locally bound subscriptions in both tracks, after verifying provider subscription/customer/salon metadata and mode. Binding mismatches remain held for reconciliation. Prepaid coverage is not changed, and no historical refund is issued.
7. Apply and retain integrity reports, verify independent balances/history, and verify paid fulfillment in the configured environment. Activate `BILLING_TOPUPS_ENABLED=true` only after readiness evidence passes. Keep subscription sales disabled.
8. Merge only with required CI and preview checks passing and review conversations resolved; production deployment uses protected main. Verify production SHA, account/ledger integrity, and configured checkout separately from general app health.

## Verification evidence

Focused tests cover signup grants and deferral, historical claim preservation, repeated backfill, shared identities, identity conflicts, tenant authorization, every package, unpaid and incorrect payment evidence, webhook replay, credit settlement/refunds/unknown outcomes, and net usage pagination. Disposable PostgreSQL tests exercise genuine row-lock concurrency and subscription refund/customer isolation. Browser checks cover desktop Chromium, mobile Chromium and WebKit, exactly one first More usage row, keyboard opening/closing, pricing, low balance, starter reloads, and horizontal overflow.

Provider provisioning and production migration are separate rollout steps. A successful build or general health response does not establish that live payments or starter identity reconciliation are ready.
